// A tiny in-memory evaluator for the aggregation pipelines the dashboard analytics use, so
// "the new code returns the same numbers as the old code" can be tested without a database.
// It supports only what those pipelines need: $match (equality, $gte, $lt, $in, $ne, $and),
// $group, $lookup (localField/foreignField), $unwind (a field path) and $project, with the
// expressions $month (with timezone), $toLower, $ifNull, $literal, $sum, $cond/$eq and
// field paths. Anything else throws, so an unsupported operator can never pass silently.

const getPath = (doc, dotted) => {
  let value = doc;
  for (const part of dotted.split(".")) {
    if (value === null || value === undefined) return undefined;
    value = value[part];
  }
  return value;
};

const monthIn = (date, timezone) => {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone || "UTC", month: "numeric" }).formatToParts(new Date(date));
  return Number(parts.find((p) => p.type === "month").value);
};

const evalExpr = (expr, doc) => {
  if (typeof expr === "string") return expr.startsWith("$") ? getPath(doc, expr.slice(1)) : expr;
  if (Array.isArray(expr)) return expr.map((item) => evalExpr(item, doc));
  if (expr === null || typeof expr !== "object" || expr instanceof Date) return expr;
  const keys = Object.keys(expr);
  if (keys.length !== 1 || !keys[0].startsWith("$")) {
    // an object of fields (used by $group _id and $project)
    return Object.fromEntries(keys.map((key) => [key, evalExpr(expr[key], doc)]));
  }
  const op = keys[0];
  const arg = expr[op];
  switch (op) {
    case "$literal":
      return arg;
    case "$month":
      return monthIn(evalExpr(arg.date, doc), arg.timezone);
    case "$toLower": {
      const value = evalExpr(arg, doc);
      return value === null || value === undefined ? "" : String(value).toLowerCase();
    }
    case "$ifNull": {
      for (const item of arg.slice(0, -1)) {
        const value = evalExpr(item, doc);
        if (value !== undefined && value !== null) return value;
      }
      return evalExpr(arg[arg.length - 1], doc);
    }
    case "$eq": {
      const [a, b] = arg.map((item) => evalExpr(item, doc));
      return a === b;
    }
    case "$cond": {
      const [test, yes, no] = arg;
      return evalExpr(test, doc) ? evalExpr(yes, doc) : evalExpr(no, doc);
    }
    default:
      throw new Error(`pipelineEval: unsupported expression ${op}`);
  }
};

const matches = (doc, condition) =>
  Object.entries(condition).every(([field, want]) => {
    if (field === "$and") return want.every((sub) => matches(doc, sub));
    const have = getPath(doc, field);
    if (want !== null && typeof want === "object" && !(want instanceof Date)) {
      return Object.entries(want).every(([op, value]) => {
        switch (op) {
          case "$gte": return have !== undefined && have !== null && have >= value;
          case "$lt": return have !== undefined && have !== null && have < value;
          case "$in": return value.includes(have);
          case "$ne": return have !== value;
          default: throw new Error(`pipelineEval: unsupported match operator ${op}`);
        }
      });
    }
    return have === want;
  });

const keyOf = (value) => JSON.stringify(value, (k, v) => (v instanceof Date ? { $d: v.toISOString() } : v));

// collections: { jobseekerprofiles: [...], ... } for $lookup.
const runPipeline = (pipeline, docs, collections = {}) => {
  let current = docs.map((doc) => ({ ...doc }));
  for (const stage of pipeline) {
    const [name] = Object.keys(stage);
    const spec = stage[name];
    switch (name) {
      case "$match":
        current = current.filter((doc) => matches(doc, spec));
        break;
      case "$group": {
        const groups = new Map();
        for (const doc of current) {
          const id = evalExpr(spec._id, doc);
          const key = keyOf(id);
          if (!groups.has(key)) groups.set(key, { _id: id });
          const group = groups.get(key);
          for (const [field, accumulator] of Object.entries(spec)) {
            if (field === "_id") continue;
            const [op, arg] = Object.entries(accumulator)[0];
            if (op !== "$sum") throw new Error(`pipelineEval: unsupported accumulator ${op}`);
            const amount = typeof arg === "number" ? arg : Number(evalExpr(arg, doc)) || 0;
            group[field] = (group[field] || 0) + amount;
          }
        }
        current = [...groups.values()];
        break;
      }
      case "$lookup": {
        const foreign = collections[spec.from] || [];
        current = current.map((doc) => ({
          ...doc,
          [spec.as]: foreign.filter((other) => String(getPath(other, spec.foreignField)) === String(getPath(doc, spec.localField))),
        }));
        break;
      }
      case "$unwind": {
        const field = (typeof spec === "string" ? spec : spec.path).slice(1);
        current = current.flatMap((doc) => (Array.isArray(doc[field]) ? doc[field].map((item) => ({ ...doc, [field]: item })) : []));
        break;
      }
      case "$project":
        current = current.map((doc) => Object.fromEntries(Object.entries(spec).map(([field, expr]) => [field, evalExpr(expr, doc)])));
        break;
      default:
        throw new Error(`pipelineEval: unsupported stage ${name}`);
    }
  }
  return current;
};

module.exports = { runPipeline, evalExpr };

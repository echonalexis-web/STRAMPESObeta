// Event names and small helpers shared by the realtime "new announcement"
// toast (components/NewsPublishedToast.jsx) and the News feed
// (pages/NewsFeed.jsx). The toast and the feed live in different parts of the
// tree, so they talk through window events instead of new shared state.

// Socket.IO event the server emits when an announcement is published.
export const NEWS_PUBLISHED_EVENT = "news:published";

// toast -> feed: "reload the feed in place with the current filters".
export const NEWS_REFRESH_EVENT = "news:refresh-request";

// feed -> toast: "I just loaded these items" (detail: { ids, newestAt, filtered }).
export const NEWS_FEED_LOADED_EVENT = "news:feed-loaded";

// Mirrors the server rule (services/newsRealtimeService.js): these categories
// are jobseeker-only, so employers are never told about them.
export const JOBSEEKER_ONLY_NEWS_CATEGORIES = ["hiring", "training", "advisory", "spes"];

// Time an item went live, in ms; 0 when the date is missing or invalid.
export const newsItemTime = (item) => {
  const time = new Date(item?.publishedAt || item?.createdAt).getTime();
  return Number.isNaN(time) ? 0 : time;
};

// Short English + Filipino function words. Dropped from "informative" tokens.
// Question words (how, where, paano, saan) are listed here but still feed
// the how/where intent cue in normalize().
const ENGLISH = [
  'a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'at', 'by', 'for', 'from', 'with', 'as', 'if',
  'is', 'are', 'am', 'was', 'were', 'be', 'been', 'do', 'does', 'did', 'done', 'can', 'could', 'will',
  'would', 'should', 'may', 'might', 'must', 'shall', 'i', 'me', 'my', 'we', 'us', 'our', 'you', 'your',
  'it', 'its', 'this', 'that', 'these', 'those', 'there', 'here', 'what', 'where', 'when', 'why', 'which',
  'who', 'whom', 'how', 'please', 'pls', 'want', 'need', 'like', 'get', 'so', 'then', 'than', 'just',
  'about', 'into', 'over', 'cannot', 'hi', 'hello', 'hey', 'ok', 'okay', 'thanks', 'thank',
  // fragments left by apostrophe splitting: can't, don't, I'm, it's, I'll
  't', 's', 'm', 'll', 're', 've', 'd', 'don', 'doesn', 'didn', 'isn', 'won', 'wasn',
];

const FILIPINO = [
  'ang', 'ng', 'mga', 'sa', 'na', 'ay', 'at', 'o', 'po', 'opo', 'ba', 'ko', 'ako', 'ka', 'mo', 'ikaw',
  'ito', 'iyan', 'iyon', 'dito', 'doon', 'diyan', 'para', 'kung', 'kapag', 'pag', 'mag', 'nag', 'ma',
  'ano', 'paano', 'saan', 'bakit', 'kailan', 'sino', 'alin', 'pwede', 'puwede', 'maaari', 'gusto',
  'nais', 'lang', 'naman', 'din', 'rin', 'may', 'mayroon', 'meron', 'yung', 'yong', 'nung', 'nang',
  'namin', 'natin', 'nila', 'niya', 'akin', 'amin', 'kami', 'tayo', 'sila', 'siya', 'ninyo', 'niyo',
  'hindi', 'di', 'kasi', 'pero', 'ngunit', 'upang', 'daw', 'raw', 'muna', 'pa', 'ho',
];

export const FILIPINO_MARKERS = new Set([...FILIPINO]);
export const STOP_WORDS = new Set([...ENGLISH, ...FILIPINO]);
export const HOW_CUES = new Set(['how', 'where', 'paano', 'saan']);

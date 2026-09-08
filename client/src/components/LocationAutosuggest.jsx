import Autosuggest from "./Autosuggest";
import { ALL_LOCATIONS } from "../utils/philippineLocations";

export default function LocationAutosuggest(props) {
  return <Autosuggest {...props} options={ALL_LOCATIONS} />;
}

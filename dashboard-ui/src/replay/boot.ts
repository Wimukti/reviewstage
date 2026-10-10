// Runs before anything else in the replay bundle (first import of main.tsx): picks the fixture
// the URL names, installs the fetch shim, puts the PR reference the page reads into the query
// string, and exposes the local counters. Nothing here touches the network.
import { exposeEvents, bump } from "./events";
import { pickFixture } from "./fixtures";
import { installFetchShim } from "./shim";
import { ReplayStore } from "./store";

const params = new URLSearchParams(window.location.search);
export const fixture = pickFixture(params.get("example"));
export const store = new ReplayStore(fixture);
installFetchShim(store);
exposeEvents();

// PrPage reads ?repo= and ?pr= from the location. The path stays wherever the host serves the
// replay (/try/app/), so a reload lands on the same page.
if (params.get("pr") !== fixture.pr || params.get("repo") !== fixture.repo) {
  params.set("example", fixture.slug);
  params.set("repo", fixture.repo);
  params.set("pr", fixture.pr);
  window.history.replaceState(window.history.state, "", `${window.location.pathname}?${params.toString()}`);
}

bump("replay_started");

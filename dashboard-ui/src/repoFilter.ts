// The queue's repository filter, remembered per browser. "" = all repositories.
const KEY = "reviewstage.repoFilter";
const EVT = "reviewstage:repo-filter";

export function getRepoFilter(): string {
  try {
    return window.localStorage.getItem(KEY) || "";
  } catch {
    return "";
  }
}

export function setRepoFilter(repo: string): void {
  try {
    if (repo) window.localStorage.setItem(KEY, repo);
    else window.localStorage.removeItem(KEY);
  } catch {
    /* private mode etc. — the filter just does not persist */
  }
  window.dispatchEvent(new Event(EVT));
}

export const REPO_FILTER_EVENT = EVT;

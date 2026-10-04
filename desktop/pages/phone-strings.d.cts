declare const strings: {
  title: string;
  opening: string;
  off: string;
  steps: string[];
  check: { ok: string; checking: string; slow: string };
  pairParts(login: string, until: string): [string, string, string, string];
  pair(login: string, until: string): string;
  signedOut: string;
  fine: string;
  fineLink: string;
  fineUrl: string;
  until(exp: number): string;
};
export = strings;

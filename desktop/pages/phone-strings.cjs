// The words of phone access, read by both the desktop phone window (pages/phone.html, as a
// plain script → window.RS_PHONE) and the dashboard's Settings card (bundled by esbuild via
// module.exports). One source, so the window and the card never drift apart.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.RS_PHONE = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  return {
    title: "Review from your phone",
    opening: "Opening a tunnel…",
    off: "Phone access is off",
    steps: [
      "Scan this with your phone's camera — you're signed in",
      "Share → Add to Home Screen",
      "Open it from the home screen; Settings → Push → this device",
    ],
    check: {
      ok: "Reachable from the internet.",
      checking: "Checking that the address is reachable… scan now; phones usually get there first.",
      slow: "This Mac still can't reach the address itself. Try scanning anyway — if the phone can't open it either, turn phone access off and on for a new address.",
    },
    // [text, login, text, time]: the window bolds the two values, the card prints the sentence.
    pairParts: function (login, until) {
      return ["Scanning signs you in as ", login || "you", ". Code valid until ", until];
    },
    pair: function (login, until) {
      return this.pairParts(login, until).join("");
    },
    signedOut: "Sign in on the Mac first and the code will sign your phone in too.",
    fine: "This address is public while phone access is on; every action still needs your sign-in. It stops when you turn phone access off or quit.",
    fineLink: "How sign-in and links are protected",
    fineUrl: "https://wimukti.github.io/reviewstage/security/",
    until: function (exp) {
      return new Date(exp * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    },
  };
});

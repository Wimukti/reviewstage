// Stub, A3 → A1 merge note: How it works is deleted (stage-light proposal). App.tsx (lane A1)
// still imports and routes `/how` here; until A1 drops the route this renders the app's
// not-found state so the route behaves as gone. Delete this file when App.tsx no longer imports it.
export function HowItWorks() {
  return (
    <>
      <h1>Not found</h1>
      <p className="muted">That page doesn't exist. Head back to your queue.</p>
    </>
  );
}

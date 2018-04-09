const { TriState, EVERYONE, GLOBAL } = require("./triState");

export default async (rbap, rules) => {
  if (!rules || rules.length === 0) {
    return;
  }
  const completedRules = rules.map(rule =>
    Object.assign({ subject: EVERYONE, object: GLOBAL, state: TriState.Allow }, rule),
  );
  await rbap.setUserRoles(
    completedRules.map(({ subject }) => subject),
    completedRules.map(({ role }) => role),
    completedRules.map(({ object }) => object),
    completedRules.map(({ state }) => state),
  );
};

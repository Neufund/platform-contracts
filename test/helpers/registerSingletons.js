export default async (universe, owner, interfaces) => {
  if (!interfaces || interfaces.length === 0) {
    return;
  }
  /* eslint-disable consistent-return */
  return universe.setManySingletons(
    interfaces.map(({ ki }) => ki),
    interfaces.map(({ addr }) => addr),
    { from: owner }
  );
};

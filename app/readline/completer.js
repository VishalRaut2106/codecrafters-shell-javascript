const { KNOWN_COMMANDS } = require("../functions/type");

const completer = (line) => {
  let hits = KNOWN_COMMANDS.filter((cmd) => cmd.startsWith(line));
  hits = hits.map((row) => row + " ");
  if (hits.length === 0) {
    process.stdout.write("\x07"); // bell
  }
  return [hits.length ? hits : [], line];
};

module.exports = { completer };

const readline = require("readline");
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});
rl.setPrompt("$ ");
rl.on("line", (command) => {
  executeCommand(command);
  if (!rl.closed) {
    rl.prompt();
  }
});
function executeCommand(command) {
  const parts = command.trim().split(" ");
  const cmd = parts[0];
  const args = parts.slice(1).join(" ");
  if (commands[cmd]) {
    commands[cmd](args);
  } else {
    console.log(`${command}: not found`);
  }
}
const commands = {
  echo: (input) => {
    console.log(input.toString().split(",").join(" "));
  },
  type: (input) => {
    commands[input]
      ? console.log(`${input} is a shell builtin`)
      : console.log(`${input}: not found`);
  },
  exit: () => {
    rl.close();
    return;
  },
};
rl.prompt();
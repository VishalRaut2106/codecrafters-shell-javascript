const readline = require("readline");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: "$ ",
});

// TODO: Uncomment the code below to pass the first stage
function repl() {
  rl.prompt();  
  rl.once("line", (line) => {
    console.log(`${line}: command not found`);
    repl();
  });
}
repl();
    
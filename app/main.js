const readline = require("readline");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: "$ ",
});

rl.prompt();  
// TODO: Uncomment the code below to pass the first stage
function repl() {
  if(command === "exit") {
    rl.close();
    return;
  }
  rl.once("line", (line) => {
    console.log(`${line}: command not found`);
    repl();
  });
}
repl();
    
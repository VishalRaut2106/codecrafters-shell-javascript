// This is the exact completer from the reference code
const readline = require("readline");
const fs = require("fs");

let lastTabLine = "";
let tabCount = 0;

const recognizedCommands = {
  echo: true,
  exit: true,
  type: true,
  pwd: true,
  cd: true,
  history: true,
};

const completer = (line) => {
  const lastSpaceIndex = line.lastIndexOf(" ");
  const isCommand = lastSpaceIndex === -1;
  const prefixToMatch = isCommand ? line : line.substring(lastSpaceIndex + 1);
  let allHits = [];

  if (isCommand) {
    const builtins = Object.keys(recognizedCommands).filter((c) =>
      c.startsWith(prefixToMatch),
    );
    const pathVar = process.env.PATH || "";
    const paths = pathVar.split(":");
    const externalMatches = new Set();
    for (const p of paths) {
      try {
        if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
          const files = fs.readdirSync(p);
          for (const file of files) {
            if (file.startsWith(prefixToMatch)) {
              externalMatches.add(file);
            }
          }
        }
      } catch (e) {
        // Skip directories that are inaccessible or do not exist
      }
    }
    allHits = Array.from(new Set([...builtins, ...externalMatches]));
  }

  allHits.sort();

  if (allHits.length === 0) {
    process.stdout.write("\x07");
    tabCount = 0;
    lastTabLine = "";
    return [[], prefixToMatch];
  }

  if (allHits.length === 1) {
    tabCount = 0;
    lastTabLine = "";
    const hit = allHits[0];
    return [[hit + " "], prefixToMatch];
  }

  const lcp = allHits.reduce((p, c) => {
    let i = 0;
    while (i < p.length && i < c.length && p[i] === c[i]) i++;
    return p.slice(0, i);
  });

  if (lcp.length > prefixToMatch.length) {
    tabCount = 0;
    lastTabLine = line.substring(0, lastSpaceIndex + 1) + lcp;
    return [[lcp], prefixToMatch];
  }

  if (line === lastTabLine) {
    tabCount++;
  } else {
    lastTabLine = line;
    tabCount = 1;
  }

  if (tabCount === 1) {
    process.stdout.write("\x07");
    return [[], prefixToMatch];
  }

  const formattedHits = allHits;
  process.stdout.write("\n" + formattedHits.join("  ") + "\n");
  rl.prompt();
  rl.write(null, { ctrl: true, name: "e" });
  tabCount = 0;
  return [[], prefixToMatch];
};

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  completer: completer,
});

rl.setPrompt("$ ");
rl.prompt();

rl.on("line", (input) => {
  console.log(`You typed: ${input}`);
  rl.prompt();
});

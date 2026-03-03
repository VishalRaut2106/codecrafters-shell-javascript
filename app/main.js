const readline = require('readline')
const { spawnSync } = require('child_process')

const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout
})

let recognizedCommands = {
	echo: (cmds) => console.log(cmds.slice(1).join(' ')),
	exit: (cmds) => process.exit(cmds[1]),
  type: (cmds) => type(cmds)
}

let executableInPath = (cmd) => {
  const res = spawnSync('which', [cmd])
  if (res.status === 0) return res.stdout.toString().replace(/(\r\n|\n|\r)/gm, '')
}

let type = (cmds) => {
  let executable = executableInPath(cmds[1])
  let builtin = isValidCommand(cmds[1], recognizedCommands)
  if (executable || builtin) {
    console.log(`${cmds[1]} is ${builtin ? 'a shell builtin' : executable}`)
  }
  else {
    console.log(`${cmds.slice(1).join(' ')}: not found`)
  }
}

rl.setPrompt('$ ')
rl.prompt()

rl.on('line', (input) => {

	let inputCommands = input.split(' ')
	let directive = inputCommands[0]

	isValidCommand(directive, recognizedCommands)
		? recognizedCommands[directive](inputCommands)
		: console.log(`${input}: command not found`)

  rl.prompt()
  
})

let isValidCommand = (cmd, commandList) => {
	return commandList.hasOwnProperty(cmd)
}
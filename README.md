[![progress-banner](https://backend.codecrafters.io/progress/shell/5ee7e47e-73c4-432c-aa11-71df8ecdb827)](https://app.codecrafters.io/users/codecrafters-bot?r=2qF)

## What I Built


I built a POSIX-style shell in JavaScript that can parse user input, execute
commands, manage built-ins, and behave like a small interactive terminal.
The project grew from a minimal REPL into a more complete shell with command
parsing, pipes, redirection, completion, history, variables, and background
process support.

Codecrafters helped me build this project. My profile is
[vishalraut21066](https://app.codecrafters.io/users/vishalraut21066).

The main implementation lives in [app/main.js](app/main.js).

## Features

- Interactive REPL with a prompt and continuous command execution
- Built-in commands such as `cd`, `pwd`, `echo`, `exit`, `type`, `history`,
	`jobs`, `complete`, and `declare`
- Execution of external programs discovered through the `PATH`
- Argument parsing with support for quotes and escaped characters
- Pipelining between commands using `|`
- Output redirection with `>`, `>>`, `1>`, `1>>`, `2>`, and `2>>`
- Tab completion for commands and file paths
- Programmable completion registration and removal with `complete -C`,
	`complete -p`, and `complete -r`
- Running registered completer scripts and using their output for completion
- Background jobs with `&`, job tracking, job listing, and automatic reaping
- Shell variables through `declare`
- Parameter expansion using `$VAR` and `${VAR}` forms
- History loading, navigation, display, and persistence through `HISTFILE`

## What I Learned

- How to build a shell loop that keeps reading input and executing commands
- How command tokenization changes when quotes, escapes, and whitespace are
	involved
- How to separate parsing, expansion, and execution so the shell stays easier
	to extend
- How to run child processes in Node.js and connect their input and output
- How background processes differ from foreground commands and why job reaping
	matters
- How shell completion works and how a completer can be driven by a script
- How variable storage and parameter expansion affect later stages of command
	execution
- How to keep behavior consistent across many features without breaking earlier
	stages

## Notes

- The shell implementation is centered in [app/main.js](app/main.js)
- Supporting utilities for tokenizing and path resolution live in
	[app/utility.js](app/utility.js)
- Built-in command registration lives in [app/constants.js](app/constants.js)

## Summary

This project is a working JavaScript shell that combines command execution,
interactive editing, process management, completion, and variable handling in
one application. It is designed as a learning project, but it now behaves like a
small practical shell for everyday command-line workflows.

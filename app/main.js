const readline = require("readline");
const path = require("path");
const fs = require('fs')

const { constants } = require('node:fs');
const { join } = require("node:path");
const { spawnSync } = require('child_process')
const { chdir, cwd } = require('node:process');

const dir_delimitador = path.delimiter;
const arr_caminhos_dir = process.env.PATH.split(dir_delimitador)

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function arquivo_existe(caminhoCompleto) {
  try {
    fs.accessSync(caminhoCompleto, constants.X_OK)
    return true
  } catch (error) {
    // captura erro ou falta de permissão
    return false
  }
}

function parsearComando(palavras) {
  const ASPAS_DUPLAS = "\""
  const ASPAS_SIMPLES = "'"
  const BARRA_INVERTIDA = '\\';
  const ESPACO = ' ';
  const CARACTERES_ESCAPAM_EM_ASPAS_DUPLAS = ['"', '\\', '$', '`'];

  const tokens = []
  let tokenAtual = '';
  let dentroDeAspasSimples = false;
  let dentroDeAspasDuplas = false;


  const deveEscaparEmAspasDuplas = (letra) => {
    return CARACTERES_ESCAPAM_EM_ASPAS_DUPLAS.includes(letra)
  }

  const temProximoCaractere = (index) => {
    return index + 1 < palavras.length;
  };

  const salvarToken = () => {
    if (tokenAtual.length > 0) {
      tokens.push(tokenAtual);
      tokenAtual = '';
    }
  };

  const processarDentroDeAspasDuplas = (i) => {
    const letra = palavras[i]

    if (letra === BARRA_INVERTIDA && temProximoCaractere(i)) {
      const proximaLetra = palavras[i + 1];

      if (deveEscaparEmAspasDuplas(proximaLetra)) {
        tokenAtual += proximaLetra;
        return i + 1;
      } else {
        tokenAtual += letra;
        return i;
      }
    }

    tokenAtual += letra;
    return i;
  }

  const processarForaDeAspas = (i) => {
    const letra = palavras[i];

    if (letra === BARRA_INVERTIDA && temProximoCaractere(i)) {
      tokenAtual += palavras[i + 1];
      return i + 1;
    }

    if (letra === ESPACO) {
      salvarToken();
      return i;
    }

    tokenAtual += letra;
    return i;
  };


  for (let i = 0; i < palavras.length; i++) {
    const letra = palavras[i];

    if (letra === ASPAS_DUPLAS && !dentroDeAspasSimples) {
      dentroDeAspasDuplas = !dentroDeAspasDuplas;
      continue;
    }

    if (letra === ASPAS_SIMPLES && !dentroDeAspasDuplas) {
      dentroDeAspasSimples = !dentroDeAspasSimples;
      continue;
    }

    if (dentroDeAspasDuplas) {
      i = processarDentroDeAspasDuplas(i);
    } else if (dentroDeAspasSimples) {
      tokenAtual += letra;
    } else {
      i = processarForaDeAspas(i);
    }
  }

  salvarToken();
  return tokens;
}

function analisarRedirecionamento(tokens) {
  const operadores = ['>', '1>', '2>']
  const operadorEncontrado = operadores.find(op => tokens.includes(op))

  if (!operadorEncontrado) {
    return { temRedirecionamento: false, tokens: tokens }
  }

  const indice = tokens.indexOf(operadorEncontrado)

  if (tokens[indice + 1] === undefined) {
    return { erro: true }
  }

  const comando = tokens.slice(0, indice)
  const arquivo = tokens[indice + 1]

  return { temRedirecionamento: true, comando, arquivo, tipoRedirecionamento: operadorEncontrado }
}

function imprimirEntrada(answer) {
  const tokens = parsearComando(answer)
  const analise = analisarRedirecionamento(tokens)

  if (!analise.temRedirecionamento) {
    const textoProEcho = tokens.slice(1).join(' ')
    return console.log(textoProEcho)
  }

  if (analise.tipoRedirecionamento === '2>') {
    const textoProEcho = analise.comando.slice(1).join(' ')
    console.log(textoProEcho)
    fs.writeFileSync(analise.arquivo, '')
    return
  }

  else {
    const conteudoInserirNoArquivo = analise.comando.slice(1)
    const textoProArquivo = conteudoInserirNoArquivo.join(' ')

    fs.writeFileSync(analise.arquivo, textoProArquivo + '\n')
  }

}

function encontrarArquivo(comando) {
  const extensoes_executaveis = process.platform === 'win32'
    ? ['.exe', '.cmd', '.bat', '.com']
    : ['']

  let caminhoEncontrado = null;

  arr_caminhos_dir.find(diretorio => {
    for (const extensao of extensoes_executaveis) {
      const caminhoCompleto = join(diretorio, `${comando}${extensao}`)
      if (arquivo_existe(caminhoCompleto)) {
        caminhoEncontrado = caminhoCompleto
        return true
      }
    }
    return false
  })

  return caminhoEncontrado
}

function checarTipo(answer) {
  const comando = answer.slice(5);

  const is_builtin = comandos_existentes.find(val => val === comando)

  if (is_builtin) {
    return console.log(`${comando} is a shell builtin`)
  }

  let caminho_encontrado;

  caminho_encontrado = encontrarArquivo(comando)

  if (caminho_encontrado) {
    console.log(`${comando} is ${caminho_encontrado}`)
  } else {
    console.log(`${comando}: not found`)
  }
}

function executarProgramaExterno(comando) {
  const tokens = parsearComando(comando)
  const analise = analisarRedirecionamento(tokens)

  const tokensComando = analise.temRedirecionamento ? analise.comando : tokens;

  const arquivo = tokensComando[0]
  const parametros = tokensComando.slice(1)

  const caminhoComArquivoExecutavel = encontrarArquivo(arquivo)

  if (!caminhoComArquivoExecutavel) {
    console.log(`${arquivo}: not found`);
    return;
  }

  const arquivoComExtensao = path.basename(caminhoComArquivoExecutavel)

  if (analise.temRedirecionamento) {

    if (analise.tipoRedirecionamento === '2>') {

      const resultado = spawnSync(arquivoComExtensao, parametros, {
        stdio: ['inherit', 'inherit', 'pipe']
      })

      fs.writeFileSync(analise.arquivo, resultado.stderr)

    } else {
      const resultado = spawnSync(arquivoComExtensao, parametros, {
        stdio: ['inherit', 'pipe', 'inherit']
      })

      fs.writeFileSync(analise.arquivo, resultado.stdout)
    }
  } else {
    spawnSync(arquivoComExtensao, parametros, {
      stdio: 'inherit'
    })
  }

}

function imprimirDiretorioAtual() {
  return console.log(process.cwd())
}

function extrairComandoEArgumentos(comandoCompleto) {
  const partes = comandoCompleto.trim().split(' ')

  return { comando: partes[0], argumentos: partes.slice(1) }
}

function mudarDiretorioAtual(mudar_diretorio) {
  const { comando, argumentos } = extrairComandoEArgumentos(mudar_diretorio)
  let diretorio = argumentos.toString();

  try {
    chdir(diretorio)
  } catch (error) {
    return console.log(`${comando}: ${diretorio}: No such file or directory`)
  }
}

const comandos_existentes = ['exit', 'echo', 'type', 'pwd', 'cd']

function ativa_recursividade() {
  rl.question("$ ", (resposta) => {

    if (resposta.match('~')) {
      resposta = resposta.replace('~', process.env.HOME)
    }

    if (resposta.startsWith('echo ')) {
      imprimirEntrada(resposta);
    }

    else if (resposta.startsWith('type ')) {
      checarTipo(resposta);
    }

    else if (resposta.startsWith('cd ')) {
      mudarDiretorioAtual(resposta)
    }

    else if (resposta.match('pwd')) {
      imprimirDiretorioAtual()
    }

    else if (resposta.match('exit')) {
      return rl.close()
    }

    else {
      executarProgramaExterno(resposta)
    }

    ativa_recursividade()
  });
}

ativa_recursividade()

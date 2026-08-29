# Ragazzo Editor · Efeitos

*[Read in English](README.md)*

Painel CEP (Common Extensibility Platform) para o Adobe Premiere Pro com atalhos de um clique para efeitos e ajustes de edição repetitivos — zoom, alinhamento, recorte, telas divididas, animações de clipe e um editor de curvas de suavização, direto no clipe selecionado da timeline.

<p align="center">
  <img src="https://img.shields.io/badge/Premiere%20Pro-15.0+-9999FF?logo=adobepremierepro&logoColor=white" alt="Premiere Pro 15.0+">
  <img src="https://img.shields.io/badge/CEP-10.0-333333" alt="CEP 10.0">
  <img src="https://img.shields.io/badge/build-nenhum%20(vanilla%20JS)-lightgrey" alt="Sem build step">
  <img src="https://img.shields.io/badge/licença-MIT-green" alt="Licença MIT">
</p>

## Funcionalidades

- **Zoom** — anima a Escala do clipe do início ao fim (in/out), com curva de aceleração ajustável e presets salváveis.
- **Alinhamento** — grid de 9 pontos de ancoragem para encostar a borda do clipe num canto/lado/centro do quadro; copiar/colar/zerar Posição, Escala, Rotação e Opacidade entre clipes.
- **Recortar** — zoom + deslocamento de âncora para simular um recorte (crop-to-fill) sem sair do Premiere.
- **Tela dividida** — 2 lado a lado, 2 empilhados ou grade 2×2, a partir dos clipes selecionados em trilhas diferentes.
- **Distribuir / Cascata** — distribui N clipes em partes iguais do quadro, ou empilha em camadas (estilo picture-in-picture) a partir da posição do primeiro clipe selecionado.
- **Corte de silêncio** — detecta pausas na fala (não silêncio genérico — a análise foca na faixa de frequência da voz humana) e gera automaticamente uma versão cortada do clipe, já inserida na timeline no lugar do original.
- **Animar clipe/objeto** — presets de entrada/saída (slide, fade, pop, girar) com duração e curva de easing configuráveis.
- **Suavizar movimento** — editor de curva bezier multi-âncora (arrastar alças, adicionar/remover pontos, alternar entre vista de Valor e de Velocidade) para redesenhar a curva entre duas keyframes existentes; ou suavização automática (média móvel) de todas as keyframes de uma vez.

Todos os efeitos são aplicados diretamente nos componentes/efeitos nativos do Premiere (Movimento, Opacidade, Lumetri, Volume) — nada é "gravado" ou renderizado à parte, exceto o Corte de silêncio, que gera um novo arquivo de mídia (via ffmpeg) e o insere na timeline.

## Temas

Dois temas disponíveis pelo seletor no cabeçalho do painel — **Escuro** (padrão) e **Papel** (claro) — com a preferência salva localmente e aplicada antes da primeira renderização (sem flash do tema errado).

## Requisitos

- Adobe Premiere Pro 15.0 ou superior.
- [ffmpeg e ffprobe](https://ffmpeg.org/download.html) acessíveis no `PATH` do sistema — usados apenas pelo Corte de silêncio, para detectar pausas e renderizar a versão cortada.

## Instalação

Esta é uma extensão CEP **não assinada**, então o Premiere precisa ser configurado para carregar extensões em modo de depuração antes de instalá-la:

1. Habilite o modo de depuração do CEP (uma vez só): no `regedit`, crie/edite a chave `HKEY_CURRENT_USER\Software\Adobe\CSXS.10` e adicione um valor de string `PlayerDebugMode` = `1`.
2. Copie esta pasta inteira para a pasta de extensões do CEP:
   ```
   %APPDATA%\Adobe\CEP\extensions\com.RagazzoEditor.efeitos
   ```
3. Abra (ou reinicie) o Premiere Pro e acesse **Janela → Extensões → Ragazzo Editor - Efeitos**.

Após qualquer alteração nos arquivos da extensão, basta recarregar o painel (fechar e reabrir pela mesma barra de menu) — só é necessário reiniciar o Premiere quando `CSXS/manifest.xml` é alterado.

## Estrutura do projeto

```
com.RagazzoEditor.efeitos/
├── CSXS/manifest.xml   # manifesto CEP: host, versão, entry points
├── index.html          # UI do painel
├── style.css           # estilos + temas (Escuro/Papel)
├── jsx/hostscript.jsx  # ExtendScript executado dentro do Premiere
└── js/
    ├── cep-bridge.js     # ponte com o host CEP (evalScript)
    ├── main.js           # wiring de eventos da UI
    ├── ui.js             # abrir/fechar cartões, sliders genéricos
    ├── theme.js           # troca de tema
    ├── curves.js         # matemática de curvas bezier (EFCurves)
    ├── graph.js           # editor de curva em canvas
    ├── curve-presets.js  # presets de curva salvos localmente
    └── silence-cut.js     # detecção/corte de pausas via ffmpeg
```

Sem build step, bundler ou dependências de terceiros — é HTML/CSS/JS puro carregado diretamente pelo Premiere.

## Contribuindo

Este é um projeto open source — issues, forks e pull requests são bem-vindos. Sinta-se à vontade para usar, modificar e redistribuir sob os termos da licença abaixo.

## Licença

[MIT](LICENSE) © Pedro Ragazzo

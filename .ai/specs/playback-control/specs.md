# Conceito

O Playback Control tem como objetivo permitir ao usuário controlar a faixa atual (pausar, reproduzir), mudar para a próxima faixa e voltar para a faixa anterior, além de exibir as informações dela. Se possível, também queremos incrementar para lidar com o volume.

Nós temos o transport-dial, que faz essa função hoje. Nós iremos nos basear nele, ajustar e então removê-lo.

# UI

O Playback Control deve ter um "layout" contendo 3 linhas, sendo que a primeira linha exibirá, em duas colunas, as informações da faixa atual, enquanto a segunda linha exibirá os controles de reprodução e o progresso da faixa.

Na primeira linha, exiba na coluna da esquerda a capa do álbum e na coluna da direita as informações da faixa atual, com o nome da música encima e do artista embaixo.

Na segunda linha, exiba: o tempo atual da faixa, um ícone exibindo se o shuffle está ativo ou não, um ícone que exibe se a reprodução está pausada ou não e, por fim, o tempo total da faixa.

Na última linha, exiba uma barra de progresso, minimalista, sem textos ou rótulos, que exibe o progresso da faixa atual.

# Comportamento

## Implementações existentes, para serem mantidas

O Playback Control deve respeitar os seguintes gatilhos, que já existem hoje no transport dial:

onDialRotate: exatamente o que acontece hoje no transport dial.
onDialDown: exatamente o que acontece hoje no transport dial, pause/play.
onTouchTap: mesmo do onDialDown

## Novas implementações, se possível

A expectativa é implementar novos recursos, caso seja possível:

1. Toque longo: se o usuário segurar o botão pressionado (sem rodar) por um tempo, intercala entre shuffle on e off, se possível. Se não for possível, continua não fazendo nada.

2. Rodar o dial com ele pressionado: se for possível utilizar esse trigger, ele deve diminuir e aumentar o volume, ESPECIFICAMENTE do aplicativo MUSIC e não do sistema (nós temos esse comportamento implementado no volume-dial, porém em outro trigger).

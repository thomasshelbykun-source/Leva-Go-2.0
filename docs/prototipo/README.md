# LevaGo 2.0: protótipo da app Cliente

Protótipo navegável da app Cliente, feito a partir dos 19 ecrãs do documento
«LevaGo – sequência dos ecrãs para o programador».

## Conteúdo
- `app-cliente/index.html`: protótipo da app Cliente (um único ficheiro, abre no navegador).
- `docs/ecras.html`: referência dos ecrãs, com as imagens, as regras e as incoerências.
- `docs/LevaGo_Resumo_Ecras.xlsx`: o mesmo resumo em folha de cálculo (regras, ecrãs, incoerências).

## Regras implementadas
- Planos: 300 MT/3, 600 MT/7, 1.000 MT/13 e 2.000 MT/28 encomendas.
- Normal: desconta 1 encomenda, sem pagamento adicional (1–3 h).
- Expressa: desconta 1 encomenda e cobra 150 MT, ou usa crédito Expressa (15 min–1 h).
- Cancelar antes da recolha devolve a encomenda ao plano. Se a Expressa já foi paga, fica crédito Expressa, sem reembolso em dinheiro.
- Agendamento dentro do horário: Dom–Qui 07–22, Sex 07–16, Sáb 17–22.

## Limites desta versão
- Os dados ficam só no navegador (localStorage); a palavra-passe fica sem proteção. Usar apenas dados de teste.
- Pagamentos M-Pesa e e-Mola simulados; o estafeta é simulado por botões no ecrã de seguimento.
- O mapa é uma imagem fixa; «Selecionar no mapa» não está implementado.
- A fonte (Plus Jakarta Sans) é carregada do Google Fonts; sem internet usa a fonte do sistema.
- Ainda por fazer: «Meus dados», «Meus endereços» e outros itens do perfil.

## Pendências do design
Ver a folha «Incoerências» em `docs/` (calendário, validade dos planos, método de pagamento «Cartão», etc.).

---
title: "Ler a máquina antes de escrever qualquer código"
description: "Antes de escolher a stack eu verifiquei o que o servidor aguentava de verdade. A resposta mudou o plano."
pubDate: 2026-08-31
lang: "pt"
translationOf: "oci-blog-part-1"
series: "oci-blog"
part: 1
tags: ["infra", "oci"]
---

A ordem tentadora é escolher o framework primeiro e descobrir as restrições
depois. Eu fiz o contrário, e isso me salvou de uma stack que não teria
sobrevivido à primeira semana.

## O que a máquina tinha de verdade

O servidor é uma instância do free tier da Oracle Cloud. No papel, 1 GB de RAM.
Na prática, depois do sistema operacional e dos serviços que já rodavam ali,
sobrava bem menos:

```
              total  used  free  available
Mem:           956M  615M   97M       193M
Swap:            0B    0B    0B
```

193 MB disponíveis e **nenhuma swap**. Dois outros serviços já moravam lá: uma
aplicação FastAPI segurando 22% da memória e um bot pequeno com mais 9%.

## Por que isso eliminou opções

Uma aplicação Node renderizada no servidor costuma ocupar entre 150 e 250 MB
residentes. Com 193 MB livres e sem swap, isso não é um encaixe apertado — é um
out-of-memory esperando para acontecer, e o kernel não escolhe educadamente o
processo que você teria escolhido. Provavelmente levaria junto um dos serviços
que já estavam ali.

A lição que eu reaprendo sempre: *meça o alvo antes de projetar para ele*.

## O que eu mudei

Duas coisas, antes de escrever uma linha de código da aplicação:

1. **Parei um serviço que não precisava rodar continuamente.** A aplicação
   FastAPI é usada de vez em quando, não o tempo todo. Tirar do boot — mantendo
   instalada e pronta para subir sob demanda — devolveu cerca de 210 MB.
2. **Adicionei swap.** Não como substituto de memória real, mas para que um
   pico inesperado vire lentidão em vez de um processo morto.

A memória disponível foi de 193 MB para mais de 400 MB. Só então a escolha da
stack virou uma decisão interessante, em vez de uma imposição.

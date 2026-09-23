---
title: "Testei as nove regras de object calisthenics num projeto de verdade"
description: "O que cada uma das nove regras de object calisthenics pede, uma versão errada de propósito ao lado de código real que a segue, e quais regras mantive, flexibilizei ou ignorei num projeto de verdade."
pubDate: 2026-09-23
lang: "pt"
translationOf: "object-calisthenics"
tags: ["python", "typescript", "arquitetura", "clean-code"]
---

Object calisthenics é um conjunto de nove regras que o Jeff Bay publicou em *The
ThoughtWorks Anthology* (2008). Elas são extremas de propósito: nada de `else`,
nada de getters, nenhuma classe com mais de duas variáveis de instância. O Bay
não as apresentou como leis para código de produção. Ele as apresentou como um
**exercício**: escreva um projeto pequeno, de umas mil linhas, seguindo as nove
à risca, e veja como isso muda o jeito que você desenha objetos. Como a
calistenia para o corpo, o que importa é o que o treino deixa, não fazer flexão
para sempre.

A seguir, cada regra ganha uma explicação curta, um **antes** que a quebra e um
**depois** que a segue. Os "depois" vêm do
[Wiredex](https://github.com/vinicius-cardoso/wiredex), um sistema que estou
construindo para gerenciar minhas peças e projetos de hardware. Onde o código já
existe, o "depois" foi copiado do repositório. Duas regras só fazem sentido na
camada de negócio que ainda estou construindo; nelas, o "depois" é o design que
estou implementando, **marcado como tal**. Todo "antes" é uma versão que escrevi
para quebrar a regra.

No final: quais regras mantive, quais flexibilizei, quais ignorei, e por quê.

## 1. Só um nível de indentação por método

Cada nível de aninhamento é mais uma condição que você precisa guardar na cabeça
para entender a linha que está lendo. A regra obriga você a extrair o bloco de
dentro para uma função com nome, e o aninhamento vira uma frase.

**Antes**: escolher o idioma da interface a partir da escolha salva ou do
navegador.

```ts
function initialLanguage(browserLanguages: readonly string[]): Language {
  const saved = localStorage.getItem("wiredex.language");
  if (saved === "en" || saved === "pt-BR") {
    return saved;
  } else {
    for (const tag of browserLanguages) {
      if (tag.toLowerCase().startsWith("pt")) {
        return "pt-BR";
      }
    }
    return "en";
  }
}
```

**Depois**:

```ts
export function initialLanguage(browserLanguages: readonly string[]): Language {
  const saved = preferences.read(LANGUAGE_KEY);
  return isLanguage(saved) ? saved : matchLanguage(browserLanguages);
}
```

O laço não sumiu. Ele foi para `matchLanguage`, que faz uma coisa só e pode ser
testada sozinha. De brinde, `preferences.read` envolve o `localStorage`, que
lança exceção quando o navegador bloqueia dados do site. A versão "antes"
quebraria ali.

## 2. Não use a palavra-chave `else`

O `else` obriga você a ler os dois ramos para entender qualquer um deles. Uma
cláusula de guarda trata o caso incomum primeiro e sai, e o caminho normal fica
em linha reta, sem indentação.

**Antes**:

```python
def _docs_path(settings: Settings, path: str) -> str | None:
    if settings.docs_enabled:
        return f"{API_PREFIX}{path}"
    else:
        return None
```

**Depois**:

```python
def _docs_path(settings: Settings, path: str) -> str | None:
    if not settings.docs_enabled:
        return None
    return f"{API_PREFIX}{path}"
```

O mesmo formato funciona em qualquer linguagem. Esta é a resolução do tema
claro/escuro/sistema no frontend:

```ts
export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (preference !== "system") return preference;
  return systemPrefersDark ? "dark" : "light";
}
```

## 3. Encapsule todos os primitivos e strings

Um `str` ou `int` puro não carrega regra nenhuma. Qualquer string entra num
parâmetro chamado `email`, e qualquer inteiro em `quantity`. Encapsular o valor
num tipo dá um lugar para as regras, e deixa o verificador de tipos distinguir
coisas que só compartilham a mesma representação.

**Antes**:

```python
database_url: str = "postgresql+asyncpg://wiredex:wiredex@localhost:5442/wiredex"
```

Funciona até o objeto de configuração ser logado, impresso num traceback ou
exibido num debugger, e a senha vai junto.

**Depois**:

```python
# SecretStr keeps the password out of logs and reprs.
database_url: SecretStr = SecretStr(DEFAULT_DATABASE_URL)
```

O `SecretStr` aparece como `**********`, e pegar o valor real exige um
`.get_secret_value()` explícito. O tipo também se pagou na hora: quando liguei o
mypy nos arquivos de teste, ele apontou um teste passando uma string comum:

```
tests/system/test_readiness.py:62: error: Argument "database_url" to "Settings" has incompatible type "str"; expected "SecretStr"  [arg-type]
```

## 4. Coleções de primeira classe

Uma classe que guarda uma coleção não deve guardar mais nada. Assim, as regras
dessa coleção, como unicidade, ordem ou limites, ficam num lugar só, em vez de
se repetirem em cada função que mexe na lista.

*A lista de materiais do Wiredex ainda está sendo construída. Este "depois" é o
design.*

**Antes**: a lista mora dentro da revisão, e a regra mora em qualquer função que
adicione a ela.

```python
def add_line(revision: Revision, line: BomLine) -> None:
    if any(existing.designator == line.designator for existing in revision.bom_lines):
        raise ValueError("duplicate designator")
    revision.bom_lines.append(line)
```

**Depois**:

```python
class BillOfMaterials:
    def __init__(self, lines: tuple[BomLine, ...] = ()) -> None:
        self._lines = lines

    def with_line(self, line: BomLine) -> "BillOfMaterials":
        if line.designator in self.designators():
            raise DuplicateDesignator(line.designator)
        return BillOfMaterials((*self._lines, line))

    def designators(self) -> frozenset[Designator]:
        return frozenset(line.designator for line in self._lines)
```

Nada mais consegue adicionar um segundo `R1`, porque nada de fora da classe
alcança a lista.

## 5. Um ponto por linha

É a Lei de Deméter numa forma que dá para contar. `a.b.c.d()` significa que seu
código sabe como três outros objetos são por dentro. Quando qualquer um deles
muda, seu código quebra. Fale com seus colaboradores diretos, e deixe que eles
falem com os deles.

**Antes**: um endpoint de readiness que atravessa o estado da aplicação até o
pool de conexões.

```python
@router.get("/health/ready")
async def ready(request: Request) -> dict[str, str]:
    async with request.app.state.engine.connect() as connection:
        await connection.execute(text("SELECT 1"))
    return {"status": "ready"}
```

**Depois**: o router pergunta a um caso de uso e não sabe nada de engines.

```python
readiness = await check_readiness()
if not readiness.is_ready:
    response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
return ReadinessResponse.from_readiness(readiness)
```

O "antes" ainda tem um bug escondido. Com o banco fora do ar, ele lança uma
exceção e devolve 500, em vez de um 503 honesto.

## 6. Não abrevie

Uma abreviação economiza algumas teclas para quem escreve e custa um momento de
decifração para cada pessoa que lê. O Bay vai além: se um nome quer ser longo,
muitas vezes é porque a coisa faz demais, e a abreviação esconde isso.

**Antes**: de um script de deploy.

```bash
wait_rdy() { for i in $(seq 1 60); do curl -sf "$U" && return 0; sleep 1; done; return 1; }
```

**Depois**:

```bash
wait_until_ready() {
  for _ in $(seq 1 60); do
    if curl --silent --fail --max-time 2 "$READY_URL" >/dev/null; then return 0; fi
    sleep 1
  done
  return 1
}
```

Flags longas também contam. `--silent --fail` dá para ler sem nunca ter aberto a
man page do curl; `-sf`, não.

## 7. Mantenha todas as entidades pequenas

Os números do Bay: nenhuma classe com mais de 50 linhas, nenhum pacote com mais
de 10 arquivos. Os limites exatos importam menos que a pressão que eles criam.
Uma classe que não pode crescer precisa se dividir, e dividir obriga você a dar
nome às partes.

**Antes**: a classe que todo projeto cria sem querer.

```python
class SystemService:
    def __init__(self, settings, engine, logger, cache, mailer): ...
    def health(self): ...
    def version(self): ...
    def readiness(self): ...
    def export_openapi(self): ...
    def reset_demo_data(self): ...
    # ... e mais 400 linhas
```

**Depois**: as mesmas responsabilidades no módulo `system` do Wiredex, um
trabalho por arquivo.

```
system/
├── domain/build_info.py                    11 lines
├── domain/readiness.py                     12 lines
├── application/ports.py                     7 lines
├── application/check_readiness.py          10 lines
├── infrastructure/sql_database_probe.py    22 lines
├── api/schemas.py                          37 lines
└── api/router.py                           33 lines
```

O maior arquivo tem 37 linhas, e o módulo inteiro tem 132.

## 8. Nenhuma classe com mais de duas variáveis de instância

É a regra que parece mais absurda, e é a que mais ensina. Uma classe com sete
campos costuma ser dois ou três conceitos dividindo o mesmo quarto. Limitar a
dois obriga esses conceitos a virarem objetos próprios.

**Antes**:

```python
class DatabaseProbe:
    def __init__(self, engine, timeout, retries, logger, settings, metrics, cache):
        ...
```

**Depois**:

```python
class SqlDatabaseProbe:
    """DatabaseProbe that runs `SELECT 1`, giving up after a short timeout."""

    def __init__(self, engine: AsyncEngine, timeout_seconds: float = 2.0) -> None:
        self._engine = engine
        self._timeout_seconds = timeout_seconds
```

Tentativas, logs e métricas não foram jogados fora. Eles pertencem a quem *usa*
a sonda. A sonda responde uma pergunta só: consigo rodar uma consulta agora?

## 9. Nada de getters, setters ou propriedades

Tirar dados de um objeto, decidir algo e empurrar o resultado de volta significa
que a decisão mora no lugar errado. Diga ao objeto o que você quer e deixe que
ele garanta as próprias regras: *diga, não pergunte*.

*O livro-razão de estoque do Wiredex ainda está sendo construído. Este "depois" é
o design.*

**Antes**:

```python
lot.quantity = lot.quantity - line.quantity
if lot.quantity < 0:
    raise ValueError("not enough stock")
```

Todo chamador precisa lembrar da checagem, e basta um esquecer para o estoque
ficar negativo.

**Depois**:

```python
lot.reserve(line.quantity)  # raises InsufficientStock, records a RESERVE movement
```

O código que já existe no Wiredex tem uma nuance. `Readiness.is_ready` *é* uma
propriedade, mas não expõe um campo para outra pessoa raciocinar em cima. Ela
responde uma pergunta a partir do próprio estado do objeto. Esse tipo de
propriedade a regra aceita.

## Aplicando de verdade: o que mantive, flexibilizei e ignorei

O Bay pensou as regras para um exercício. Num sistema real, eu as uso como padrão
forte num lugar, e como direção no resto.

**Onde elas valem.** Rigorosamente na camada de domínio (regras de negócio em
Python puro), com folga nos casos de uso, e **de jeito nenhum** em schemas de
resposta, mapeamentos de ORM, componentes React e testes. Isso é formato de dado
e cola. Este schema Pydantic quebra a regra 3 três vezes, de propósito:

```python
class VersionResponse(BaseModel):
    version: str
    commit: str
    built_at: datetime | None
```

O trabalho dele é virar JSON e um schema OpenAPI, e desse schema sai um cliente
TypeScript gerado. Encapsular os campos pioraria o cliente e não deixaria nada
mais seguro.

**Regras que flexibilizo:**

- **Indentação (1):** `matchLanguage` tem um laço com `if`s dentro, ou seja, dois
  níveis. `SqlDatabaseProbe.is_reachable` tem três: um `try`, um `async with`
  para o timeout e outro `async with` para a conexão. Context managers aninhados
  se leem melhor que separados, então eu garanto um orçamento de complexidade em
  vez de contar indentação.
- **Um ponto por linha (5):** builders fluentes ficam de fora.
  `select(Part).where(...).order_by(...)` e `page.getByRole("button").click()`
  continuam falando com o mesmo objeto; não atravessam estranhos.
- **Abreviações (6):** os termos do próprio domínio continuam curtos. BOM, MPN,
  GPIO e I²C são como gente de hardware fala, e escrever por extenso deixaria o
  código *menos* familiar para elas.
- **Duas variáveis de instância (8):** é uma meta. Agregados como uma revisão de
  projeto vão agrupar o estado em value objects em vez de contar campos.

**Regras que uma máquina garante.** Regra que mora só num documento é esquecida,
então três delas quebram o build:

```toml
[tool.ruff.lint.mccabe]
max-complexity = 6   # rule 1, approximately

[tool.ruff.lint.pylint]
max-args = 5         # rule 7, approximately
```

Mais o `RET505` do ruff, que é exatamente a regra 2. Escrevi de propósito uma
função ruim de reserva de estoque para ver as travas funcionando:

```
$ uv run ruff check src/wiredex/_scratch/reserve.py
src/wiredex/_scratch/reserve.py:1:5: C901 `reserve` is too complex (7 > 6)
src/wiredex/_scratch/reserve.py:1:5: PLR0913 Too many arguments in function definition (6 > 5)
src/wiredex/_scratch/reserve.py:10:5: RET505 [*] Unnecessary `else` after `return` statement
src/wiredex/_scratch/reserve.py:13:9: RET505 [*] Unnecessary `else` after `return` statement
src/wiredex/_scratch/reserve.py:16:13: RET505 [*] Unnecessary `else` after `return` statement
```

São aproximações. Complexidade conta desvios, não indentação, então uma função
pode passar e ainda aninhar demais. Mas o CI lembra do orçamento quando eu
esqueço, e o resto fica para a revisão de código.

## A lição

Faça o exercício uma vez, à risca, em algo pequeno. É ali que as regras mudam o
jeito que você pensa. Depois, em código real, decida *onde* elas valem antes de
escrever, deixe um linter cuidar das regras que ele consegue checar, e trate o
resto como a direção para onde seus objetos devem ir, não como checklist.

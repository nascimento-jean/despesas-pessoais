# Despesas Pessoais

Aplicativo web instalável para organizar renda, despesas, cartões, metas,
investimentos e orçamento familiar.

**[Abrir o aplicativo](https://nascimento-jean.github.io/despesas-pessoais/)**

## Principais recursos

- controle mensal de renda, despesas e investimentos;
- cartões, faturas, metas e limites por categoria;
- lançamentos manuais, por texto e por voz;
- relatórios com gráficos em Excel e PDF;
- backup e restauração;
- instalação no Android, iPhone e computador;
- modo pessoal, local e offline;
- espaços financeiros compartilhados com atualização em tempo real;
- permissões de proprietário, editor e visualizador;
- convites temporários e isolamento de dados por participante.

## Instalar no Android

1. Abra o [Despesas Pessoais](https://nascimento-jean.github.io/despesas-pessoais/)
   no Google Chrome.
2. Toque em **Instalar** na parte superior do aplicativo.
3. Confirme a instalação.
4. Abra o aplicativo pelo ícone criado na tela inicial.

Se o botão não aparecer, abra o menu `⋮` do Chrome e escolha
**Adicionar à tela inicial** ou **Instalar aplicativo**.

## Instalar no iPhone

1. Abra o [Despesas Pessoais](https://nascimento-jean.github.io/despesas-pessoais/)
   no Safari.
2. Toque em **Compartilhar**.
3. Escolha **Adicionar à Tela de Início**.
4. Ative **Abrir como App da Web**, quando essa opção aparecer.
5. Toque em **Adicionar**.

## Modos de uso

### Pessoal

Não exige conta. Os dados permanecem no aparelho e grande parte do aplicativo
funciona offline. Faça um backup antes de desinstalar, limpar o navegador ou
trocar de telefone.

### Compartilhado

Exige uma conta por e-mail. O proprietário cria um espaço, como “Orçamento da
família”, e envia um convite válido por sete dias. O convidado pode receber
permissão para editar ou apenas visualizar. Alterações feitas por participantes
aparecem nos outros aparelhos em tempo real.

O modo compartilhado não deve ser usado para guardar número completo do cartão,
CVV, senhas ou credenciais bancárias.

## Ativar a sincronização

O aplicativo usa Supabase para autenticação, banco de dados, permissões e tempo
real. Para ativar esse recurso na publicação:

1. Crie um projeto no Supabase.
2. Execute [`supabase/schema.sql`](supabase/schema.sql) no SQL Editor.
3. Em **Authentication → URL Configuration**, cadastre:
   `https://nascimento-jean.github.io/despesas-pessoais/`.
4. Copie a URL do projeto e a chave pública `anon`/`publishable`.
5. Preencha esses dois valores em
   [`github-pages/supabase-config.js`](github-pages/supabase-config.js).

Nunca coloque uma chave `service_role` no aplicativo. As políticas RLS do
arquivo SQL são obrigatórias para impedir que um usuário leia dados de outro.

## Desenvolvimento e validação

Os arquivos publicados estão em `github-pages/`. Para validar:

```bash
node tests/validate-github-pages.cjs
node tests/smoke-github-pages.cjs
```

## Privacidade

No modo pessoal, os dados ficam no dispositivo. No modo compartilhado, somente
participantes autorizados conseguem acessar o espaço. O usuário pode retornar
ao modo pessoal a qualquer momento.

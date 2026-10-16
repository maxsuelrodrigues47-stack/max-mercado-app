# Max Mercado — versão completa inicial

Aplicação full-stack para demonstração/comercialização: loja pública por slug, catálogo persistido no PostgreSQL, carrinho no navegador, pedidos salvos no banco e enviados para WhatsApp, painel do mercado e estrutura multi-loja.

## Antes de divulgar
- Este é um MVP inicial, não uma plataforma auditada. Teste tudo antes de usar com clientes reais.
- Configure `DATABASE_URL`, `JWT_SECRET`, `DEFAULT_ADMIN_PASSWORD` e `PLATFORM_ADMIN_KEY` com segredos fortes.
- Não armazene dados de cartão. O pagamento é combinado no mercado; o checkout apenas registra a opção escolhida.
- Configure política de privacidade, termos, suporte, backups e regras de proteção de dados antes de uso comercial.
- GitHub Pages não executa Node.js. Publique o backend em uma hospedagem Node e use a URL gerada para a loja.
- O plano gratuito e o banco podem ter limites/expiração. Verifique as condições atuais da hospedagem.

## Rodar localmente
1. Instale Node.js 20+ e PostgreSQL.
2. Crie um banco PostgreSQL vazio.
3. Copie `.env.example` para `.env` e ajuste `DATABASE_URL` e senhas.
4. No terminal dentro da pasta: `npm install` e `npm start`.
5. Abra `http://localhost:3000`.
6. Painel: `http://localhost:3000/admin` usando o e-mail/senha configurados.

## Primeiro acesso
O primeiro mercado e usuário administrador são criados automaticamente. A senha inicial vem de `DEFAULT_ADMIN_PASSWORD`. Troque-a antes de publicar.

## Criar outro mercado
Use o endpoint protegido por `PLATFORM_ADMIN_KEY`:

`POST /api/platform/stores`

Cabeçalho: `x-platform-key: SUA_CHAVE`

JSON:
```json
{
  "name": "Mercado Exemplo",
  "slug": "mercado-exemplo",
  "whatsapp": "5516999999999",
  "adminEmail": "dono@mercado.com",
  "adminPassword": "SenhaForteAqui123!"
}
```

Cada mercado terá loja em `/s/SLUG` e painel em `/admin?store=SLUG`.
O endpoint só deve ser chamado pelo operador da plataforma, nunca colocar a chave no site público.

## Hospedagem
Importe este projeto para uma hospedagem que execute Node.js (ex.: serviço web) e configure as variáveis de ambiente. Crie um PostgreSQL e copie sua URL para `DATABASE_URL`. `render.yaml` é um ponto de partida; pode ser necessário selecionar o banco e definir as variáveis no painel da hospedagem.

## Recursos
- Catálogo, busca e categorias
- Adicionar/editar/ocultar/excluir produtos no painel
- Preço, descrição, categoria, imagem (URL) e estoque
- Pedidos salvos no banco com endereço, telefone, pagamento e status
- Botão para abrir pedido no WhatsApp (cliente precisa tocar em Enviar)
- Separação de lojas por slug e usuário administrador por loja

## Limitações atuais
- Imagens são URL externa, não upload.
- Sem gateway de pagamento online, emissão fiscal, entrega calculada ou recuperação de senha.
- Não é uma garantia de conformidade legal/segurança. Faça revisão técnica antes de vender para clientes.

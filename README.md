# Bambuí Entregadores — novo projeto

Aplicativo criado do zero em React, TypeScript e Vite, responsivo para celular e instalável como PWA após publicação HTTPS.

## Funções prontas

- Login com Supabase Auth.
- Painel do administrador: pedidos, filtros, lojas, entregadores e criação de entrega.
- Área do entregador: somente suas entregas, rota no Google Maps e avanço de status.
- Conexão preparada para o Supabase informado, sem criar ou modificar tabelas/políticas.

## Executar

Com Node.js instalado: `npm install` e `npm run dev`.

O arquivo `.env.local` fica apenas nesta cópia local e não deve ser enviado ao GitHub. Para publicação, as mesmas duas variáveis devem ser cadastradas no ambiente da Vercel.

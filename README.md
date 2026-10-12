# ChatNest

给出目标，让 Agent 查找线索、阅读网页、核对内容，并交付可追溯的结果。

基于官方 [vercel/chatbot](https://github.com/vercel/chatbot) 改造，采用 Next.js、Vercel AI SDK 和原模板组件。保留上游代码历史与 Apache 2.0 许可；领域方法由 Skills 封装，执行能力优先接入现成 MCP 工具。

- 对话、浏览器/文档/来源工作区，以及可暂停和接管的浏览器会话。
- 目标式任务入口、按需加载的 Skills、真实工具状态与执行确认。
- 支持 OpenAI 兼容接口的自定义地址、模型与密钥，也支持 Vercel AI Gateway。
- 默认接入免密钥、限流的 Exa 搜索与网页读取 MCP；可选 Tavily。

## 本地运行

复制 `.env.example` 为本地 `.env.local`，设置 `AUTH_SECRET`、`POSTGRES_URL` 和模型连接。OpenAI 兼容接口使用 `MODEL_PROVIDER=openai`、`OPENAI_API_KEY`、`OPENAI_BASE_URL`、`OPENAI_MODEL`；不需要 Gateway Key。要启用内置浏览器，设置 `BROWSER_RUNTIME=local`，并安装匹配版本的 Chromium。

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm exec playwright install chromium
corepack pnpm db:migrate
corepack pnpm dev --hostname 127.0.0.1 --port 3003
```

`.env.local`、实际密钥、日志与本地截图不提交。完整配置、验证记录、上游更新方式及功能边界见 [DEVELOPMENT.md](DEVELOPMENT.md)。当前任务在会话内运行，没有后台持久任务保证；知识产权调查交付的是待核验线索。

<details>
<summary>上游 Vercel Chatbot 模板说明</summary>

<a href="https://chatbot.ai-sdk.dev/demo">
  <img alt="Chatbot" src="app/(chat)/opengraph-image.png">
  <h1 align="center">Chatbot</h1>
</a>

<p align="center">
    Chatbot (formerly AI Chatbot) is a free, open-source template built with Next.js and the AI SDK that helps you quickly build powerful chatbot applications.
</p>

<p align="center">
  <a href="https://chatbot.ai-sdk.dev/docs"><strong>Read Docs</strong></a> ·
  <a href="#features"><strong>Features</strong></a> ·
  <a href="#model-providers"><strong>Model Providers</strong></a> ·
  <a href="#deploy-your-own"><strong>Deploy Your Own</strong></a> ·
  <a href="#running-locally"><strong>Running locally</strong></a>
</p>
<br/>

## Features

- [Next.js](https://nextjs.org) App Router
  - Advanced routing for seamless navigation and performance
  - React Server Components (RSCs) and Server Actions for server-side rendering and increased performance
- [AI SDK](https://ai-sdk.dev/docs/introduction)
  - Unified API for generating text, structured objects, and tool calls with LLMs
  - Hooks for building dynamic chat and generative user interfaces
  - Supports OpenAI, Anthropic, Google, xAI, and other model providers via AI Gateway
- [shadcn/ui](https://ui.shadcn.com)
  - Styling with [Tailwind CSS](https://tailwindcss.com)
  - Component primitives from [Radix UI](https://radix-ui.com) for accessibility and flexibility
- Data Persistence
  - [Neon Serverless Postgres](https://vercel.com/marketplace/neon) for saving chat history and user data
  - [Vercel Blob](https://vercel.com/storage/blob) for efficient file storage
- [Auth.js](https://authjs.dev)
  - Simple and secure authentication

## Model Providers

This template uses the [Vercel AI Gateway](https://vercel.com/docs/ai-gateway) to access multiple AI models through a unified interface. Models are configured in `lib/ai/models.ts` with per-model provider routing. Included models: Mistral, Moonshot, DeepSeek, OpenAI, and xAI.

### AI Gateway Authentication

**For Vercel deployments**: Authentication is handled automatically via OIDC tokens.

**For non-Vercel deployments**: You need to provide an AI Gateway API key by setting the `AI_GATEWAY_API_KEY` environment variable in your `.env.local` file.

With the [AI SDK](https://ai-sdk.dev/docs/introduction), you can also switch to direct LLM providers like [OpenAI](https://openai.com), [Anthropic](https://anthropic.com), [Cohere](https://cohere.com/), and [many more](https://ai-sdk.dev/providers/ai-sdk-providers) with just a few lines of code.

## Deploy Your Own

You can deploy your own version of Chatbot to Vercel with one click:

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/templates/next.js/chatbot)

## Running locally

You will need to use the environment variables [defined in `.env.example`](.env.example) to run Chatbot. It's recommended you use [Vercel Environment Variables](https://vercel.com/docs/projects/environment-variables) for this, but a `.env` file is all that is necessary.

> Note: You should not commit your `.env` file or it will expose secrets that will allow others to control access to your various AI and authentication provider accounts.

1. Install Vercel CLI: `npm i -g vercel`
2. Link local instance with Vercel and GitHub accounts (creates `.vercel` directory): `vercel link`
3. Download your environment variables: `vercel env pull`

```bash
pnpm install
pnpm db:migrate # Setup database or apply latest database changes
pnpm dev
```

</details>

Your app template should now be running on [localhost:3000](http://localhost:3000).

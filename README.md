<a name="readme-top"></a>

<div align="center">

<img height="120" src="https://github.com/bermudi/ai-commit-bermudi/blob/main/images/logo.png?raw=true">

<h1>AI Commit (bermudi fork)</h1>

Use OpenAI / Azure OpenAI / DeepSeek / Gemini API to review both staged and unstaged Git changes (including untracked files), generate conventional commit messages that meet the conventions, simplify the commit process, and keep the commit conventions consistent. Fork follows the [Conventional Commits 2.0.2 (Unofficial) specification](https://github.com/bermudi/conventional-commits-unofficial) and can include branch metadata and a digest of recent commits inside the prompt.

**English** · [Report Bug][github-issues-link] · [Request Feature][github-issues-link]

<!-- SHIELD GROUP -->

[![][github-contributors-shield]][github-contributors-link]
[![][github-forks-shield]][github-forks-link]
[![][github-stars-shield]][github-stars-link]
[![][github-issues-shield]][github-issues-link]
[![][vscode-marketplace-shield]][vscode-marketplace-link]
[![][total-installs-shield]][total-installs-link]
[![][avarage-rating-shield]][avarage-rating-link]
[![][github-license-shield]][github-license-link]


</div>

## ✨ Features

- 🤯 Generate commit messages from staged diffs or a combined unstaged diff that now includes untracked files and handles binary reads safely.
- 🧠 Include branch name and recent commits (when enabled) in the AI prompt for richer context.
- 🗺️ Support multi-language commit messages.
- 😜 Support adding Gitmoji.
- 🛠️ Support custom system prompt.
- 📝 Support Conventional Commits 2.0.2 (optimized for AI workflows).

## 📦 Installation

1. Search for "AI Commit" in VSCode and click the "Install" button.
2. Install it directly from the [Visual Studio Code Marketplace](https://marketplace.visualstudio.com/items?itemName=Sitoi.ai-commit).

> **Note**\
> Make sure your node version >= 16

## 🤯 Usage

1. Ensure that you have installed and enabled the "AI Commit" extension.
2. In VSCode settings, locate the "ai-commit" configuration options and configure them as needed.
3. Make changes in your project and add the changes to the staging area (git add).
4. (Optional) If you want to provide additional context for the commit message, type it in the Source Control panel's message input box before clicking the AI Commit button.
5. Next to the commit message input box in the "Source Control" panel, click the "AI Commit" icon button. After clicking, the extension will generate a commit message (considering any additional context if provided as well as branch and recent commits context) and populate it in the input box. You can commit either staged changes or rely on the unstaged/working copy diff that now includes untracked files.
6. Review the generated commit message, and if you are satisfied, proceed to commit your changes.

> **Note**\
> If the code exceeds the maximum token length, consider adding it to the staging area in batches.

### ⚙️ Configuration

> **Note** Use `USE_GITMOJI` to toggle Gitmoji output. To fully customize behaviour, provide `SYSTEM_PROMPT` (the built-in prompts are condensed summaries of the [full specification](https://github.com/bermudi/conventional-commits-unofficial); see [prompt/with_gitmoji.md](./prompt/with_gitmoji.md) and [prompt/without_gitmoji.md](./prompt/without_gitmoji.md)).

In the VSCode settings, locate the "ai-commit" configuration options and configure them as needed:

| Configuration           |  Type   |       Default        |  Required   |                                                       Notes                                                        |
| :---------------------- | :-----: | :------------------: | :---------: | :----------------------------------------------------------------------------------------------------------------: |
| AI_PROVIDER             | string  |        openai        |     Yes      | Select AI provider: `openai`, `gemini`, or `poe`. Azure OpenAI also uses `openai`. |
| OPENAI_API_KEY          | string  |         None         | Conditional | Required when `AI_PROVIDER` is `openai` (OpenAI or Azure). [Get a key](https://platform.openai.com/account/api-keys). |
| OPENAI_BASE_URL         | string  |         None         |  Optional   | Set when using Azure OpenAI or a custom endpoint, e.g. `https://{resource}.openai.azure.com/openai/deployments/{model}`. |
| OPENAI_MODEL            | string  |        gpt-4o        |  Optional   | Change via the `Show Available OpenAI Models` command. |
| AZURE_API_VERSION       | string  |         None         | Conditional | Required only when `OPENAI_BASE_URL` targets Azure OpenAI. |
| OPENAI_TEMPERATURE      | number  |         0.7          |  Optional   | Controls randomness (0-2). Lower values are more deterministic; higher values are more creative. |
| GEMINI_API_KEY          | string  |         None         | Conditional | Required when `AI_PROVIDER` is `gemini`. [Get a key](https://makersuite.google.com/app/apikey). |
| GEMINI_MODEL            | string  | gemini-2.0-flash-001 |  Optional   | Gemini model selection is currently configuration-only. |
| GEMINI_TEMPERATURE      | number  |         0.7          |  Optional   | Controls randomness (0-2). Lower values are more focused; higher values are more creative. |
| POE_API_KEY             | string  |         None         | Conditional | Required when `AI_PROVIDER` is `poe`. [Get a key](https://poe.com/api_key). |
| POE_MODEL               | string  | Claude-Sonnet-4.5    |  Optional   | Select via the `Show Available Poe Models` command after authenticating. |
| POE_TEMPERATURE         | number  |         0.7          |  Optional   | Controls randomness (0-2) for Poe chats. |
| REASONING_MODE          | string  |      balanced        |  Optional   | Single control for all providers: `auto`, `fast`, `balanced`, `deep`. Overrides map to provider-specific knobs. |
| AI_COMMIT_LANGUAGE      | string  |        English       |  Optional   |                         Supports 19 languages (see setting for the full list).                                     |
| USE_GITMOJI             | boolean |         true         |  Optional   |                         Include Gitmoji in generated commit messages. Set to `false` to disable.                   |
| AI_COMMIT_SYSTEM_PROMPT | string  |         None         |  Optional   |                    Override the default prompt; leave blank to use the built-in template.                          |
| AI_COMMIT_SYSTEM_APPEND | string  |         None         |  Optional   |                    Additional text to append to the system prompt for generating commit messages.                          |

| ENABLE_RECENT_COMMITS_CONTEXT | boolean | true | Optional | Include a short list of recent commits in the AI prompt. Disable to keep prompts focused on the current diff only. |

## ⌨️ Local Development

You can use Github Codespaces for online development:

[![][github-codespace-shield]][github-codespace-link]

Alternatively, you can clone the repository and run the following commands for local development:

```bash
$ git clone https://github.com/bermudi/ai-commit-bermudi.git
$ cd ai-commit-bermudi
$ pnpm install
$ pnpm package
```

Fork built with ⚡ **esbuild** for blazing fast builds.

## 🤝 Contributing

Contributions of all types are more than welcome, if you are interested in contributing code, feel free to check out our GitHub [Issues][github-issues-link] to get stuck in to show us what you’re made of.

[![][pr-welcome-shield]][pr-welcome-link]

### 💗 All Thanks To Our Contributors

[![][github-contrib-shield]][github-contrib-link]

## 🔗 Links

### Credits

- **ai-commit** - <https://github.com/sitoi/ai-commit>
- **auto-commit** - <https://github.com/lynxife/auto-commit>
- **opencommit** - <https://github.com/di-sukharev/opencommit>

---

## 📝 License

This project is [MIT](./LICENSE) licensed.

<!-- LINK GROUP -->

[github-codespace-link]: https://codespaces.new/bermudi/ai-commit-bermudi
[github-codespace-shield]: https://github.com/bermudi/ai-commit-bermudi/blob/main/images/codespaces.png?raw=true
[github-contributors-link]: https://github.com/bermudi/ai-commit-bermudi/graphs/contributors
[github-contributors-shield]: https://img.shields.io/github/contributors/bermudi/ai-commit-bermudi?color=c4f042&labelColor=black&style=flat-square
[github-forks-link]: https://github.com/bermudi/ai-commit-bermudi/network/members
[github-forks-shield]: https://img.shields.io/github/forks/bermudi/ai-commit-bermudi?color=8ae8ff&labelColor=black&style=flat-square
[github-issues-link]: https://github.com/bermudi/ai-commit-bermudi/issues
[github-issues-shield]: https://img.shields.io/github/issues/bermudi/ai-commit-bermudi?color=ff80eb&labelColor=black&style=flat-square
[github-license-link]: https://github.com/bermudi/ai-commit-bermudi/blob/main/LICENSE
[github-license-shield]: https://img.shields.io/github/license/bermudi/ai-commit-bermudi?color=white&labelColor=black&style=flat-square
[github-stars-link]: https://github.com/bermudi/ai-commit-bermudi/network/stargazers
[github-stars-shield]: https://img.shields.io/github/stars/bermudi/ai-commit-bermudi?color=ffcb47&labelColor=black&style=flat-square
[pr-welcome-link]: https://github.com/bermudi/ai-commit-bermudi/pulls
[pr-welcome-shield]: https://img.shields.io/badge/🤯_pr_welcome-%E2%86%92-ffcb47?labelColor=black&style=for-the-badge
[github-contrib-link]: https://github.com/bermudi/ai-commit-bermudi/graphs/contributors
[github-contrib-shield]: https://contrib.rocks/image?repo=bermudi%2Fai-commit-bermudi
[vscode-marketplace-link]: https://marketplace.visualstudio.com/items?itemName=bermudi.ai-commit-bermudi
[vscode-marketplace-shield]: https://img.shields.io/vscode-marketplace/v/bermudi.ai-commit-bermudi.svg?label=vscode%20marketplace&color=blue&labelColor=black&style=flat-square
[total-installs-link]: https://marketplace.visualstudio.com/items?itemName=bermudi.ai-commit-bermudi
[total-installs-shield]: https://img.shields.io/vscode-marketplace/d/bermudi.ai-commit-bermudi.svg?&color=greeen&labelColor=black&style=flat-square
[avarage-rating-link]: https://marketplace.visualstudio.com/items?itemName=bermudi.ai-commit-bermudi
[avarage-rating-shield]: https://img.shields.io/vscode-marketplace/r/bermudi.ai-commit-bermudi.svg?&color=green&labelColor=black&style=flat-square
--- END OF FILE README.md ---
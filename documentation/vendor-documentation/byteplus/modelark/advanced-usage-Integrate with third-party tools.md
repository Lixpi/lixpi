The ModelArk API is compatible with OpenAI and Anthropic's interface protocols, and supports usage in third\-party tools. Refer to this document for configuration and usage.

<div data-tips="true" data-tips-type="warning" data-tips-is-title="true">Note</div>


<div data-tips="true" data-tips-type="warning">For personal development scenarios, it is recommended to subscribe to the <a href="https://www.byteplus.com/activity/codingplan">Coding Plan package</a>. For integration tutorials, refer to <a href="https://docs.byteplus.com/en/docs/ModelArk/1928261">Quick start guide</a>.</div>



<card mode="container" align="left" >

<span id="793c3004"></span>
# **About ModelArk Coding Plan**

<span id="634735c0"></span>
## **Benefits**

ModelArk Coding Plan is an AI coding subscription service built for developers. It supports not only mainstream large language models, but also embedding models for vectorization—significantly improving coding efficiency and code quality.

<span id="7988a33e"></span>
## **Coding Plan vs ModelArk API**


* Billing



<span aceTableMode="list" aceTableWidth="1,4,3"></span>
|Integration<br><br>Method |Coding Plan |API |
|---|---|---|
|Billing Method |Subscribe to the Coding Plan package, see [Subscription options](https://docs.byteplus.com/en/docs/ModelArk/1925114#6e51df70).<br><br><div data-tips="true" data-tips-type="tip" data-tips-is-title="true">tip</div><br><br><br><div data-tips="true" data-tips-type="tip">The package offers discounted pricing, lower token unit price, and is cost\\-effective.</div><br> |Postpaid based on token usage |



* Core configuration

   There are differences between the two methods in supported models and Base URL. Pay attention to the distinction during configuration.



<span aceTableMode="list" aceTableWidth="1,1,3,3"></span>
|Integration Method ||ModelArk Coding Plan |ModelArk API invocation |
|---|---|---|---|
|Supported Models ||* In configuration, set \`ark-code-latest\`.<br><br>* On the [activation management page](https://console.byteplus.com/ark/region:ark+ap-southeast-1/openManagement), you can select or switch models. See [Supported models](https://docs.byteplus.com/en/docs/ModelArk/1925114#9f209b6d) for details. |* Compatible with Anthropic protocol (such as Claude Code): supports Seed\\-1.8, GLM\\-4.7, DeepSeek\\-V3.2, and Kimi\\-K2\\-thinking.<br><br>* Compatible with OpenAI protocol (such as OpenCode, Cline, and more): supports all language models, can be selected as needed. |
|Base URL |Compatible with Anthropic protocol |\`https://ark.ap-southeast.bytepluses.com/api/coding\` |\`https://ark.ap-southeast.bytepluses.com/api/compatible\` |
||Compatible with OpenAI protocol |\`https://ark.ap-southeast.bytepluses.com/api/coding/v3\` |\`https://ark.ap-southeast.bytepluses.com/api/v3\` |


</card>



<span id="46b8dd4f"></span>
# Ecosystem compatibility

To meet developers' needs for using the OpenAI API and Anthropic API ecosystems, ModelArk API has added adaptation support for both interface protocols, fully compatible with mainstream large model interface specifications and related tool ecosystems.

You do not need to modify core code; simply switch the Base URL and API Key to achieve cross\-platform model invocation and tool integration.

When configuring third\-party tools, refer to the table below for the required Base URL information.


<span aceTableMode="list" aceTableWidth="1,2,2"></span>
|Protocol |Base URL |Applicable tools |
|---|---|---|
|Compatible with Anthropic protocol |`https://ark.ap-southeast.bytepluses.com/api/compatible` |Claude Code |
|Compatible with OpenAI protocol |`https://ark.ap-southeast.bytepluses.com/api/v3` |Chatbox, Cherry Studio, OpenClaw (formerly Clawdbot), Cline, Cursor, Kilo Code, Roo Code, OpenCode, and more. |


<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>


<div data-tips="true" data-tips-type="tip">Before configuring tools, you need to <a href="https://console.byteplus.com/ark/region:ark+ap-southeast-1/openManagement?LLM=%7B%7D&advancedActiveKey=model">activate the required model service</a>.</div>


<span id="54bbb3c5"></span>
# Chatbox

<span id="f8d4a451"></span>
## Install

Download and install the appropriate version from the [Chatbox official website](https://chatboxai.app/zh), or directly **start the web version**.

<span id="47f5a8a0"></span>
## Configure

Open Chatbox and go to the settings page.


1. In Model Provider, click to add a provider, and select **API Mode** as `OpenAI API Compatible`.

2. After the provider is added successfully, configure the following information.

   * **API Key**: [Get API Key](https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey)

   * **API Host**: `https://ark.ap-southeast.bytepluses.com/api/v3`

   * **API Path**: `/chat/completions`

   * **Model**: [Select model and get Model ID](https://docs.byteplus.com/en/docs/ModelArk/1330310#b318deb2)


After configuration is complete, you can input your requirements in the input box and interact with the model.

<span id="fa588d0f"></span>
# Cherry Studio

<span id="e5089140"></span>
## Install

Download and install the Cherry Studio client from the [Cherry Studio official website](https://www.cherry-ai.com/).

<span id="e816fe94"></span>
## Configure

Open the Cherry Studio client and go to the settings page.


1. In Model Service, click to add a provider, and select **provider type** as `OpenAI`.

2. After the provider is added successfully, configure the following information.

   * **API Key**: [Get API Key](https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey)

   * **API Address**: `https://ark.ap-southeast.bytepluses.com/api/v3`

   * **Model**: Click to add a model, and enter the [Model ID](https://docs.byteplus.com/en/docs/ModelArk/1330310#b318deb2) you want to use


After configuration is complete, you can input your requirements in the input box and interact with the model.

<span id="adcc555a"></span>
# Claude Code

<div data-tips="true" data-tips-type="warning" data-tips-is-title="true">Note</div>


<div data-tips="true" data-tips-type="warning">For personal development scenarios, it is recommended to subscribe to the <a href="https://www.byteplus.com/activity/codingplan">Coding Plan package</a>. For integration instructions, see <a href="https://docs.byteplus.com/en/docs/ModelArk/1928262">Claude Code</a>.</div>


<span id="f2c6f75f"></span>
## Install

Prerequisites:


* Install [Node.js 18 or later](https://nodejs.org/en/download/).

* Windows users need to install [Git for Windows](https://git-scm.com/download/win).


In the command\-line interface, execute the following command to install Claude Code.

```Bash
npm install -g @anthropic-ai/claude-code
```


After installation is complete, execute the following command to view the installation result. If the version number is displayed, the installation was successful.

```Bash
claude --version
```


<span id="90f14e9f"></span>
## Configure

After completing the installation of Claude Code, configure the following information.


* **ANTHROPIC_BASE_URL**: `https://ark.ap-southeast.bytepluses.com/api/compatible`

* **ANTHROPIC_AUTH_TOKEN**: [Get API Key](https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey)

* **ANTHROPIC_MODEL**: Supported models seed\-1\-8\-251228, glm\-4\-7\-251222, and deepseek\-v3\-2\-251201.


<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>


<div data-tips="true" data-tips-type="tip">Starting from Claude Code v2.0.7x, the logic for loading and reading environment variables has changed. When logging in for the first time or after executing <code>logout</code> and logging in again, the <code>~/.claude/settings.json</code> <strong>env</strong> configuration may not take effect. It is recommended to write environment variables into the Shell startup configuration file.</div>



<Tabs>
<Tab zoneid="QV5EKbuxtI" title="macOS & Linux">
<TabTitle>macOS & Linux</TabTitle>

1. Run the following command in the terminal to view the current Shell type.

   ```Bash
   echo $SHELL
   ```
   

2. Configure environment variables according to the Shell type.

   ```Bash
   # If SHELL is zsh; run the following command.
   nano ~/.zshrc
   # If SHELL is bash; run the following command.
   nano ~/.bashrc
   ```
   


Append the following content to the end of the file. Please replace <ARK_API_KEY\> with your ModelArk API Key, andwith the model ID you want to use. Save and exit the editor.

```Plain Text
```Bash
export ANTHROPIC_BASE_URL="https://ark.ap-southeast.bytepluses.com/api/compatible"
export ANTHROPIC_AUTH_TOKEN="<ARK_API_KEY>"
export ANTHROPIC_MODEL="<Model ID>"

export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC="1"

# Avoid conflicts with local Anthropic configuration
export ANTHROPIC_API_KEY=""
```
```



3. Run the following command in the terminal to make the configuration take effect.

   ```Bash
   # For zsh, run the following command.
   source ~/.zshrc
   # For bash, run the following command.
   source ~/.bashrc
   ```
   

4. Run the following command in the terminal to verify whether the environment variables have taken effect.

   ```Bash
   echo $ANTHROPIC_BASE_URL
   echo $ANTHROPIC_MODEL
   ```
   


</Tab>
<Tab zoneid="ixAz4cwbJu" title="Windows">
<TabTitle>Windows</TabTitle>

<span id="189f19d1"></span>
### CMD


1. Run the following command in CMD to set environment variables.

   ```Bash
   setx ANTHROPIC_AUTH_TOKEN <ARK_API_KEY>
   setx ANTHROPIC_BASE_URL https://ark.ap-southeast.bytepluses.com/api/compatible
   setx ANTHROPIC_MODEL <Model>
   ```
   

2. Run the following command in a new CMD window to check whether the environment variables have taken effect.

   ```Bash
   echo %ANTHROPIC_AUTH_TOKEN%
   echo %ANTHROPIC_BASE_URL%
   echo %ANTHROPIC_MODEL%
   ```
   


<span id="5bb843d6"></span>
### PowerShell


1. Run the following command in PowerShell to set environment variables.

   ```PowerShell
   [System.Environment]::SetEnvironmentVariable('ANTHROPIC_AUTH_TOKEN', '<ARK_API_KEY>', 'User')
   [System.Environment]::SetEnvironmentVariable('ANTHROPIC_BASE_URL', 'https://ark.cn-beijing.volces.com/api/compatible', 'User')
   [System.Environment]::SetEnvironmentVariable('ANTHROPIC_MODEL', '<Model>', 'User')
   ```
   

2. Run the following command in a new PowerShell window to check whether the environment variables have taken effect.

   ```PowerShell
   echo $env:ANTHROPIC_AUTH_TOKEN
   echo $env:ANTHROPIC_BASE_URL
   echo $env:ANTHROPIC_MODEL
   ```
   


</Tab>
</Tabs>


<span id="e6679ac5"></span>
## Use Claude Code


* Start Claude Code: Go to the project directory and execute the `claude` command to get started with Claude Code.

   ```Bash
   cd my-project
   claude
   ```
   

* Model status verification: Input `/status` to confirm the model status.


If the following message appears, it may be because you have previously logged in to Claude Code. You can input `/logout` to log out, and then start Claude Code again.

```Plain Text
```JSON
{
    "error": {
        "code": "AuthenticationError",
        "message": "The API key format is incorrect. Request id:0217xxxxxxx",
        "param": "",
        "type": "Unauthorized"
    }
}
```
```


<span id="572e98de"></span>
## Use Claude Code IDE plugin


1. Install Claude Code and configure the environment variables.


The Claude Code IDE plugin depends on the Claude Code CLI tool. You need to complete the installation and configuration of Claude Code first.

2. Install and use the IDE plugin.

> As the IDE plugin will be iteratively updated, the following content is for reference only. For specific installation and usage, refer to [Visual Studio Code](https://code.claude.com/docs/en/vs-code) and [JetBrains IDEs](https://code.claude.com/docs/en/jetbrains).


```Plain Text
```mixin-react
return (<Tabs>
<Tabs.TabPane title="Claude Code VSCode plugin" key="q6mtL2bArM"><RenderMd content={`:::tip
The Claude Code VSCode plugin supports use in VSCode and VSCode-based IDEs (such as Cursor, Trae, and many others).
:::

<span id="e712c542"></span>
### Install plugin

Open VSCode and search for \`claude code\` in the extension marketplace to install.

![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/6c39c8cb4ec84f03bb0ca2444804eac7~tplv-goo7wpa0wc-image.image =1202x)

<span id="24ce507c"></span>
### Get started

After installation, click the Claude Code icon in the upper right corner of VSCode to enter the Claude Code page. Once initialization is complete, you can start using it.

![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/388665c0f9ed47379faa5291e180a6b2~tplv-goo7wpa0wc-image.image =1738x)`}></RenderMd></Tabs.TabPane>
<Tabs.TabPane title="Claude Code Jetbrains plugin" key="Nqimr10BEJ"><RenderMd content={`:::tip
The Claude Code Jetbrains plugin supports Jetbrains IDEs such as IntelliJ IDEA, PyCharm, WebStorm, and many others.
:::

<span id="1c2ca175"></span>
### Install plugin

Open Jetbrains IDE and search for \`claude code\` in the plugin marketplace to install.

![Image](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/5859916985a34036bb41f5097ba58f6c~tplv-goo7wpa0wc-image.image =2334x)

<span id="7e4642c2"></span>
### Get started

After installation, restart the IDE, click the Claude Code icon, and enter the Claude Code page and start using it.`}></RenderMd></Tabs.TabPane></Tabs>);
```
```


<span id="64a1f959"></span>
# OpenCode

<div data-tips="true" data-tips-type="warning" data-tips-is-title="true">Note</div>


<div data-tips="true" data-tips-type="warning">For individual development scenarios, it is recommended to subscribe to the <a href="https://www.byteplus.com/activity/codingplan">Coding Plan package</a>. For integration instructions, refer to <a href="https://docs.byteplus.com/en/docs/ModelArk/2188958">OpenCode</a>.</div>


<span id="2fabead0"></span>
## Install

In the command\-line interface, execute the following command to install OpenCode.

```Bash
npm install -g opencode-ai
```


After installation is complete, execute the following command to view the installation result. If the version number is displayed, the installation was successful.

```Bash
opencode --version
```


<span id="9c68a77b"></span>
## Configure


1. Edit the OpenCode configuration file `~/.config/opencode/opencode.json`.


For example, to configure the model `seed-1-8-251228`, the configuration information is as follows.

<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>



* <div data-tips="true" data-tips-type="tip">Replace <a href="https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey"><ARK_API_KEY\></a> in the configuration information.</div>


* <div data-tips="true" data-tips-type="tip">Select the model as needed and obtain the <a href="https://docs.byteplus.com/en/docs/ModelArk/1330310#b318deb2">Model ID</a>.</div>



```Plain Text
```JSON
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "myprovider": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "volcengine",
      "options": {
        "baseURL": "https://ark.ap-southeast.bytepluses.com/api/v3",
        "apiKey": "<ARK_API_KEY>"
      },
      "models": {
    "seed-1-8-251228": { 
      "name": "seed-1-8-251228"
    }
      }
    }
  }
}
```
```


<span id="0bcfc664"></span>
## Get started


1. Start OpenCode:

   ```Bash
   opencode
   ```
   

2. Input `/models`, select the configured `seed-1-8-251228` model and use it in OpenCode.


<span id="0cfc8e87"></span>
# OpenClaw (formerly Clawdbot)

<div data-tips="true" data-tips-type="warning" data-tips-is-title="true">Note</div>


<div data-tips="true" data-tips-type="warning">For individual development scenarios, it is recommended to subscribe to the <a href="https://www.byteplus.com/activity/codingplan">Coding Plan package</a>. For integration instructions, refer to <a href="https://docs.byteplus.com/en/docs/ModelArk/2183190">OpenClaw (Clawdbot)</a>.</div>


<span id="2754877f"></span>
## Install


1. Execute the following command to install OpenClaw.



<Tabs>
<Tab zoneid="Edz2cyCCv2" title="macOS">
<TabTitle>macOS</TabTitle>

```Bash
curl -fsSL https://openclaw.ai/install.sh | bash
```



</Tab>
<Tab zoneid="ee9HSXlHep" title="Windows">
<TabTitle>Windows</TabTitle>

The installation command for Windows PowerShell environment is as follows:

```Bash
iwr -useb https://openclaw.ai/install.ps1 | iex
```



</Tab>
</Tabs>



2. Complete the configuration according to the prompts. Refer to the following configuration.



|Note |Configuration |
|---|---|
|I understand this is powerful and inherently risky. Continue? |Select "Yes" |
|Onboarding mode |Select "QuickStart" |
|Model/auth provider |Select "Skip for now"; you can configure this later. |
|Filter models by provider |Select "All providers" |
|Default model |Use the default configuration |
|Select channel (QuickStart) |Select "Skip for now"; you can configure this later. |
|Configure skills now? (recommended) |Select "No"; you can configure this later. |
|Enable hooks? |Press the spacebar to select an option, then press Enter to proceed to the next step.<br><br><span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ead19a3a5d0f49538b6289594fcccf90~tplv-goo7wpa0wc-image.image) </span> |
|How do you want to hatch your bot? |Select "Hatch in TUI".<br><br><span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/69295ee8ade64371abcfa6729414d4a4~tplv-goo7wpa0wc-image.image) </span> |


<span id="28931850"></span>
## Configure

<span id="06ceef4a"></span>
### View configuration


<Tabs>
<Tab zoneid="UOCu5Vb0tO" title="View in Web UI">
<TabTitle>View in Web UI</TabTitle>

In the Web UI, select **Settings** \- **Config** \- **Authentication**, then at the bottom select **Raw** to view the configuration information.

<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/8d500ec5582c407dae56ddb5f6034738~tplv-goo7wpa0wc-image.image) </span>


</Tab>
<Tab zoneid="k2mt5RGsJX" title="View in terminal">
<TabTitle>View in terminal</TabTitle>

Run the following command in the terminal to view the configuration information.

```Bash
cat ~/.openclaw/openclaw.json
```



</Tab>
</Tabs>


<span id="d602f662"></span>
### Edit configuration

You can refer to the following configuration content. The core configuration information that needs to be modified is as follows:


* baseUrl: `https://ark.ap-southeast.bytepluses.com/api/v3`

* apiKey: [Get API Key](https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey)

* models: [Select a model and get the Model ID](https://docs.byteplus.com/en/docs/ModelArk/1330310#b318deb2)


```JSON
{
  "meta": {
    "lastTouchedVersion": "2026.1.24-3",
    "lastTouchedAt": "2026-01-27T08:01:28.453Z"
  },
  "wizard": {
    "lastRunAt": "2026-01-27T07:34:55.069Z",
    "lastRunVersion": "2026.1.24-3",
    "lastRunCommand": "onboard",
    "lastRunMode": "local"
  },
  "auth": {
    "profiles": { // Authentication configuration information
      "byteplus:default": {
        "provider": "byteplus",
        "mode": "api_key"
      }
    }
  },
  "models": {
    "providers": {
      "byteplus": {
        "baseUrl": "https://ark.ap-southeast.bytepluses.com/api/v3", // Base URL for Coding Plan
        "apiKey": "<ARK_API_KEY>", // Replace with the actual API KEY
        "api": "openai-completions",
        "models": [ // Model supported by Coding Plan
          {
            "id": "seed-1-8-251228",
            "name": "seed-1-8-251228"
          }
        ]
      }
    }
  },
  "agents": {
    "defaults": { // Model information
      "model": {
        "primary": "byteplus/seed-1-8-251228"
      },
      "models": {
        "byteplus/seed-1-8-251228": {
          "alias": "byteplus"
        }
      },
      "workspace": "/Users/*****/clawd", // Pay attention to path permissions for macOS and Windows
      "compaction": {
        "mode": "safeguard"
      },
      "maxConcurrent": 4,
      "subagents": {
        "maxConcurrent": 8
      }
    }
  },
  "messages": {
    "ackReactionScope": "group-mentions"
  },
  "commands": {
    "native": "auto",
    "nativeSkills": "auto"
  },
  "hooks": {
    "internal": {
      "enabled": true,
      "entries": {
        "command-logger": {
          "enabled": true
        },
        "session-memory": {
          "enabled": true
        }
      }
    }
  },
  "gateway": {
    "port": 18789,
    "mode": "local",
    "bind": "loopback",
    "auth": {
      "mode": "token",
      "token": "<YOUR_GATEWAY_TOKEN>" // Replace with the corresponding TOKEN, which can be obtained in Overview - Gateway Token
    },
    "tailscale": {
      "mode": "off",
      "resetOnExit": false
    }
  },
  "plugins": { // Plugin configuration information
    "entries": {}
  }
}
```


<span id="208c7fd8"></span>
### Save and restart


<Tabs>
<Tab zoneid="CVJQ9YLRG5" title="Web UI method">
<TabTitle>Web UI method</TabTitle>

After editing the configuration in the Web UI, first click **Save**. Once saved, click **Update**.


</Tab>
<Tab zoneid="ez44V8Mkwb" title="Terminal method">
<TabTitle>Terminal method</TabTitle>

After editing the configuration information, run the following command in the terminal to restart the service and apply the changes.

<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">tip</div>


<div data-tips="true" data-tips-type="tip">When executing the following command, if you see the prompt <code>zsh: command not found: moltbot</code>, please try the following commands: <code>clawdbot gateway stop</code>, <code>clawdbot gateway start</code>, or <code>clawdbot gateway restart</code>.</div>


```Bash
# Method 1: Stop the service, then start the service
# Stop the service
openclaw gateway stop
# Wait 2–3 seconds before starting the service
openclaw gateway start
# Method 2: Use the restart command directly
openclaw gateway restart
```



</Tab>
</Tabs>


After the configuration takes effect, you can use OpenClaw.

<span id="800352f1"></span>
## Get started

<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>


<div data-tips="true" data-tips-type="tip">If you see the prompt <code>zsh: command not found: moltbot</code> when running the following command, try the following commands: <code>clawdbot tui</code>, <code>clawdbot dashboard</code>.</div>



* Open TUI and view the Gateway status.


```Bash
openclaw tui
/status
```



* Open Web UI and interact on the Chat page.


```Bash
openclaw dashboard
```


<span id="e0d1b023"></span>
# TRAE

<span id="58d363c0"></span>
## Install

Go to the [TRAE official website](https://www.trae.ai/), download and install the version for your operating system.

<span id="c6be47e5"></span>
## Configure


1. Open **Settings** \> **Models**, click **Add Model**.

2. Select **BytePlus** as the provider, and then select a model.

3. [Get API key](https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey)


<span id="ad7ff0e8"></span>
## Switch models

In the lower\-right corner of the AI chat input box, click the current model name and select the configured model from the list.

After selecting a model, you can start using TRAE for development tasks.

<span id="8cf0e46e"></span>
# Cline

<div data-tips="true" data-tips-type="warning" data-tips-is-title="true">Note</div>


<div data-tips="true" data-tips-type="warning">For individual development scenarios, it is recommended to subscribe to the <a href="https://www.byteplus.com/activity/codingplan">Coding Plan package</a>. For integration instructions, refer to <a href="https://docs.byteplus.com/en/docs/ModelArk/2188959">Other tools</a>.</div>


<span id="9e8b45ff"></span>
## Install

Open VSCode, search for `Cline` in the extension marketplace, and install it.

<span id="a1998577"></span>
## Configure

After the Cline plugin is installed, you need to configure the following information.


* **API Provider**: `OpenAI Compatible` (Coding Plan interface is compatible with the OpenAI standard)

* **Base URL**: `https://ark.ap-southeast.bytepluses.com/api/v3`

* **API Key**: [Get API Key](https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey)

* **Model ID**: Select a model as needed and obtain the [Model ID](https://docs.byteplus.com/en/docs/ModelArk/1330310#b318deb2)


After configuration is complete, you can input your requirements in the input box and interact with the model.

<span id="43252d72"></span>
# Cursor

<div data-tips="true" data-tips-type="warning" data-tips-is-title="true">Note</div>


<div data-tips="true" data-tips-type="warning">For individual development scenarios, it is recommended to subscribe to the <a href="https://www.byteplus.com/activity/codingplan">Coding Plan package</a>. For integration instructions, refer to <a href="https://docs.byteplus.com/en/docs/ModelArk/2188959">Other tools</a>.</div>


<span id="eb949c8b"></span>
## Install

Download the installation package from the official website: Download and install Cursor via the [Cursor official website](https://cursor.com/features).

<span id="14785575"></span>
## Configure

<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>


<div data-tips="true" data-tips-type="tip">Due to Cursor limitations, only users subscribed to Cursor Pro or higher plans can customize model configurations.</div>


After Cursor is installed, you need to log in to a paid account to configure Models. The specific configuration of the Models module is as follows:


* OpenAI API Key: [Obtain API Key](https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey)

* Override OpenAI Base URL: `https://ark.ap-southeast.bytepluses.com/api/v3`

* Add Custom Model: Select a model as needed and obtain the [Model ID](https://docs.byteplus.com/en/docs/ModelArk/1330310#b318deb2)


After configuration is complete, you can select the configured model in the chat panel to interact with it.

<span id="803716d6"></span>
# Roo Code

<div data-tips="true" data-tips-type="warning" data-tips-is-title="true">Note</div>


<div data-tips="true" data-tips-type="warning">For individual development scenarios, it is recommended to subscribe to the <a href="https://www.byteplus.com/activity/codingplan">Coding Plan package</a>. For integration instructions, refer to <a href="https://docs.byteplus.com/en/docs/ModelArk/2188959">Other tools</a>.</div>


<span id="ea3c94f0"></span>
## Install

Open VSCode, search for `Roo Code` in the extension marketplace to install it. After installation, select Trust Publisher.

<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/dd47c5150044469cb4e95b8de067d817~tplv-goo7wpa0wc-image.image) </span>

<span id="a9ebc613"></span>
## Configure

After installation, configure the following information.


* **API Provider**: `OpenAI Compatible` (Coding Plan interface is compatible with the OpenAI standard)

* **Base URL**: `https://ark.ap-southeast.bytepluses.com/api/v3`

* **API Key**: [Obtain API Key](https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey)

* **Model**: Select a model as needed and obtain the [Model ID](https://docs.byteplus.com/en/docs/ModelArk/1330310#b318deb2)


After configuration is complete, you can input your requirements in the input box and interact with the model.

<span id="398e865d"></span>
# Kilo Code

<div data-tips="true" data-tips-type="warning" data-tips-is-title="true">Note</div>


<div data-tips="true" data-tips-type="warning">For individual development scenarios, it is recommended to subscribe to the <a href="https://www.byteplus.com/activity/codingplan">Coding Plan package</a>. For integration instructions, refer to <a href="https://docs.byteplus.com/en/docs/ModelArk/2188959">Other tools</a>.</div>


<span id="7518dbe3"></span>
## Install

Open VSCode, search for `kilo code` in the extension marketplace to install it. After installation, select Trust Publisher.

<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/3e991c168c0c49bc9449f6f6efc29bd7~tplv-goo7wpa0wc-image.image) </span>

<span id="3a8a6d3b"></span>
## Configure

Select Use your own API key, then configure the following information.


* **API Provider**：`Anthropic`

* **Base URL**: `https://ark.ap-southeast.bytepluses.com/api/coding/v3`

* **API Key**: [Obtain API Key](https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey)

* **Model**: Select any model (**Caution**: Regardless of which model is selected, the model seed\-code is used by default and cannot be changed for now.)

   After configuration is complete, you can input your requirements in the input box and interact with the model.





Prompt engineering involves writing efficient and stable instructions for models to continuously generate expected content. This article explains how to optimize and manage prompts for large language models, ensuring efficiency, stability, structure, and evaluability.


* Choose an interface: Compatible with the OpenAI API protocol ([Compatible with OpenAI API](https://docs.byteplus.com/en/docs/ModelArk/1330626)), supports [Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request) (recommended) and [Chat API](https://docs.byteplus.com/en/docs/ModelArk/1494384). For more information, see [Migrate to Responses API](https://docs.byteplus.com/history/folder/folder-untitled-2/translation-archive-responses-api-tutorial.md).

* Evaluation first: It is recommended to establish evaluation and regression mechanisms to ensure the controllability of prompt iterations.

* Permission configuration: For first\-time access, see [Quick Start (Ark for TT)](https://docs.byteplus.com/get-started/quick-start-tt.md) to obtain the API Key and configure the environment.


<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>


<div data-tips="true" data-tips-type="tip">Prompt guidelines for other models:</div>



* <div data-tips="true" data-tips-type="tip">Image generation: <a href="https://docs.byteplus.com/en/docs/ModelArk/1829186">Seedream 4.0\-4.5 prompt guide</a>, <a href="https://docs.byteplus.com/en/docs/ModelArk/1795150">Seedream 3.0 prompt guide</a></div>


* <div data-tips="true" data-tips-type="tip">Video generation: <a href="https://docs.byteplus.com/en/docs/ModelArk/1587797">Seedance\-1.0\-pro&pro\-fast prompt guide</a>, <a href="https://docs.byteplus.com/en/docs/ModelArk/1587797">Seedance\-1.0\-lite prompt guide</a></div>



<span id="14d9972e"></span>
## Choose model and prompt strategy


|**Models** |**Tasks and scenarios** |**Prompt style** |
|---|---|---|
|Text generation model with deep thinking |Complex tasks and multistep planning. Scenarios requiring analysis, decomposition, and decision\-making |Provide goals and constraints only, and let the model formulate its own plan and verify |
|Text generation model without deep thinking or with it disabled |Suitable for highly templated scenarios. Clear instructions and structured output |More explicit instructions, providing precise steps, formats, and examples |


<span id="214b48a1"></span>
## Recommended procedure

First, build evaluation standards and datasets to help measure the effect of changes such as prompt optimization.


* Iteration process: Update → Test → Debug → Evaluate; Manage changes and differences with versions.

* Data size recommendation: It is recommended to use hundreds to thousands of samples to ensure diversity and representativeness, covering positive/negative examples, boundary conditions, and multiple corpora. Large models can be used to expand the evaluation set.


<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>


<div data-tips="true" data-tips-type="tip"><strong>Prompt engineering tool: Prompt Pilot</strong></div>


<div data-tips="true" data-tips-type="tip"><a href="https://console.byteplus.com/ark/region:ark+ap-southeast-1/autope">Prompt Pilot</a> from ModelArk can help you build an end\-to\-end prompt optimization process. Simply provide the initial prompt to intelligently complete the full prompt engineering process:</div>



* <div data-tips="true" data-tips-type="tip">Automatically generate evaluation datasets from the initial prompt.</div>


* <div data-tips="true" data-tips-type="tip">Generate model responses and automatically score them.</div>


* <div data-tips="true" data-tips-type="tip">Intelligently optimize the prompt and generate an intelligent optimization report.</div>



<span id="5efc1d4d"></span>
## Understand roles and instruction compliance


* `system`: High\-priority rules and business logic, used to set identity, tone, boundaries, and tool usage specifications.

* `user`: User input, expressing needs and specific questions.

* `assistant`: Model output.

* `tool`: Messages for function/plugin calls in tool invocation scenarios.


<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>


<div data-tips="true" data-tips-type="tip">Recommendation: Place stably reused information in <code>system</code> or <code>instructions</code> and pass it early in each call to improve consistency and maintainability.</div>


<span id="29385080"></span>
## **Structured content: Markdown and XML**

Use structured content to let the model clearly know "where the rules are, where the examples are, and where the reference materials are".


* Markdown: Use partitions (titles, lists) to express hierarchy and specifications, such as Identity, Instructions, Examples, and Context.

* Use lightweight XML tags to explicitly create boundaries for context and example blocks, and write metadata through attributes.


Example:

```Plain
# Identity
You are a corporate document assistant, responsible for outputting clear and fact-checkable content.

# Instructions
* Use concise language when answering, prioritizing lists and subheadings.
* Wrap external links, interfaces, paths, and variable names with backticks (`...`).
* When examples are needed, provide short, directly runnable code.
* If uncertain, clearly list assumptions and items to be confirmed.

# Examples
<user_query id="q1">Please generate a weekly report summary template.</user_query>
<assistant_response id="q1">
## Weekly progress
- Core outputs:
- Quantitative metrics:

## Next week's plan
- Key tasks:
- Risks and dependencies:
</assistant_response>

# Context
<repo_docs source="ark-internal">Allowed to reference internal corporate wikis and API documents.</repo_docs>
```


<span id="1dd0890a"></span>
## **Few\-shot learning**

Guide the model to generalize without fine\-tuning by providing a few examples.

Example (sentiment classification):

```Plain
# Identity
You are a sentiment classifier that only outputs words (Positive / Negative / Neutral).

# Instructions
* Output only one word, no extra punctuation or explanations.
* Responses are only allowed to be: Positive / Negative / Neutral.

# Examples
<review id="e1">This headphone has great sound quality!</review>
<assistant_response id="e1">Positive</assistant_response>

<review id="e2">Battery life is average, and the build quality is just so-so.</review>
<assistant_response id="e2">Neutral</assistant_response>

<review id="e3">The customer service experience is terrible; I won't buy again.</review>
<assistant_response id="e3">Negative</assistant_response>
```


<span id="68d8de3a"></span>
## Chain of thought (CoT): Thinking time and step guidance


* Zero\-shot: Add "Let's analyze and think step by step" in appropriate scenarios to improve the stability of complex reasoning.

* Few\-shot: Provide examples of decomposition processes to demonstrate correct intermediate inferences and final answers.

* Specify steps: Provide execution steps and completion standards for the task to ensure output order and completeness.


Example (specified steps):

```Plain
> Please complete the task by taking the following steps:
> 1. Clarify goals and constraints
> 2. List required inputs and available tools
> 3. Execute and record key intermediate results
> 4. Provide the final structured output (parameters: result, evidence, next_step)
```


<span id="f7d5576c"></span>
## Input necessary knowledge


* When to add knowledge: When you need to reference proprietary data, technical documents, policy clauses, or restrict the scope of answers.

* Common methods:

   * Insert retrieval results (vector database / keywords) into `system`/`user` messages or `instructions`.

   * Use built\-in tools in ModelArk: knowledge base, file retrieval, web parsing plugins, web search, etc.

* Context window:

   * Pay attention to cropping and simplification (summarization) because the context window sizes vary with models.

   * Place stable agreements/rules at the beginning and task\-specific context at the end.


<span id="7629415f"></span>
## Common scenarios

<span id="bd407f2b"></span>
### General tasks


* Specify core role and background: Clearly specify the role identity for performing the task (namely {role}) to define the identity boundaries and capability scope for subsequent task execution, and ensure that the prompt can guide the model to work from the professional perspective and behavioral logic of the corresponding role.

* Provide clear context: Provide clear {context}, which is a key basis for the model to understand the task background, relevant conditions, and constraints. This enables the model to respond while accurately grasping the task's context and avoids deviations in task execution caused by missing information.

* Define specific tasks: Precisely describe the {task} to clarify the core goals and work content that the model needs to complete, so that the model clearly knows the objective and ensures that subsequent actions focus on the core of the task without deviating from the task's main purpose.

* Formulate execution rules: List specific execution rules (for example, Rule 1, Rule 2) to standardize the model's behavior and decision\-making criteria during task completion, ensuring that the model's task execution process meets expected requirements and improves the consistency and accuracy of task execution.

* Guide with examples: Provide at least two examples (Example 1, Example 2) containing "Question: {question}" and "Output: {response}" to show the expected input and output forms, helping the model better understand the task requirements and achieve more accurate task responses.

* Clarify output requirements:

   * **Specify output format**: Clearly specify the format that the model's final output should follow, such as lists, tables, paragraphs, etc., to ensure the output structure is easy to read, understand, and use.

   * **Provide detailed specification**: Clarify the detailed requirements that need to be met in the output format, such as content completeness, language styles, data accuracy standards, etc., to further constrain output quality and make the model output more in line with actual application needs.


Templates:

```Plain
> Suppose you are a {role}, and you will solve {task} based on {context}. Execute according to the following rules:
> 1. Rule 1
> 2. Rule 2
> 
> Example 1:
> Question: {question}
> Output: {response}
> 
> Example 2:
> Question: {question}
> Output: {response}
> 
> Please answer:
> Question: {question}
> Output:
> 
> Requirements:
> 1. Specify output format
> 2. Provide detailed specifications to be met in the format
```


<span id="768a70ef"></span>
### **Programming**


* Specify roles and workflow: Specify "when to call tools and when to avoid interactive execution" in `system`/`instructions`.

* Test and verify: Require unit testing or command\-level verification for patches/changes; remember to check whether changes take effect in IDE or proxy tools.

* Provide tool invocation examples: Provide specific format examples of function/command calls to improve compliance.

* Define Markdown output standards: Wrap paths, commands, and identifiers in backticks; use lists and tables to keep the text clear.


<span id="b16c4231"></span>
### **Role\-playing**

For more information, see [Skylark Role Creation Guide](https://docs.byteplus.com/en/docs/ModelArk/1256348).

```Plain
> You are a {role}, known as {xxx}, born in {background and context}.
> 
> Personality traits:
> Language style:
> Interpersonal relationships:
> Past experiences:
> Classic lines or catchphrases:
> 
> {Line 1 (you can describe actions, emotions, and background in parentheses to enrich the context)}
> {Line 2}
```


<span id="b3181503"></span>
### **Agent scenarios (long\-term tasks / multi\-tool collaboration)** 


* Planning and persistence: Require complete resolution of user requests, splitting into subtasks and tracking completion status.

* Transparency: Briefly explain the reason for calling the tool before key steps (for example, switching retrieval sources, enabling web plugins, etc.).

* Progress management: Maintain structured progress with TODO or Rubric; in the ModelArk ecosystem, it can be combined with the Starter apps and MCP plugin system.


<span id="b04c5422"></span>
## Context management and cost optimization


* Use [Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request) to simplify context management. In multi\-turn conversations, historical information can be passed through `previous_response_id` without manual management. For details, see [Context management](https://docs.byteplus.com/en/docs/ModelArk/2123288).

* Use context caching to reduce costs: For fixed system information and multi\-turn conversations, reduce request costs by using low\-cost cached inputs. For details, see [Context caching overview](https://docs.byteplus.com/en/docs/ModelArk/1398933).





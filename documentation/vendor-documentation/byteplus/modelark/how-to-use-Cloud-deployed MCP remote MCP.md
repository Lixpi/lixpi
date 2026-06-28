<span id="e2bd9c96"></span>
## Core Features


* **Broad MCP ecosystem compatibility**: Supports a wide range of domain\-specific MCP tools from the open\-source ecosystem with no need to implement tool logic yourself.

* **Multi\-turn tool calls**: Handles complex tasks (e.g., multi\-step data querying and analysis) with multi\-turn MCP calls, automatically feeding each tool’s output into the next round’s model input (e.g., MCP data query → model analysis → follow\-up query).

* **Flexible mixed calls**: Combines MCP tools with user\-defined functions. There is currently no limit on tool combinations.


<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>


<div data-tips="true" data-tips-type="tip">To test, add the header '<code>ark-beta-mcp: true</code>' when invoking this tool; for invocation methods, see <a href="https://docs.byteplus.com/en/docs/ModelArk/1827534#d20c754a">Quick start</a>.</div>


<span id="d20c754a"></span>
## Quick start

Below are two common invocation examples. Replace `<ARK_API_KEY>` with your actual key, and set `server_label` / `server_url` to your actual MCP server information.

<span id="3601f0fd"></span>
### Get the MCP URL

Visit a popular MCP marketplace and choose a cloud\-deployed MCP/Remote MCP. On its details page, generate and copy the MCP invocation URL.

<span id="6be913c2"></span>
### Example 1: Basic MCP tool invocation

**Scenario**: Query a specified repo via the Knowledge Base MCP; no user approval required.


<Tabs>
<Tab zoneid="evYDdSSJqN" title="curl">
<TabTitle>curl</TabTitle>

```Bash
curl --location 'https://ark.ap-southeast.bytepluses.com/api/v3/responses' \\
--header "Authorization: Bearer <ARK_API_KEY>" \\
--header 'Content-Type: application/json' \\
--header 'ark-beta-mcp: true' \\
--data '{
    "model": "seed-2-0-lite-260228",
    "stream": true,
    "tools": [
        {
            "type": "mcp",
            "server_label": "deepwiki",
            "server_url": "https://mcp.deepwiki.com/mcp",
            "require_approval": "never"
        }
    ],
    "input": [
        {
            "role": "user",
            "content": [
                {
                    "type": "input_text",
                    "text": "Check the documentation for the byteplus/ai-app-lab repository."
                }
            ]
        }
    ]
}'

```



</Tab>
<Tab zoneid="n7pDK7ndWP" title="Python SDK">
<TabTitle>Python SDK</TabTitle>

```Python
from byteplussdkarkruntime import Ark
import os

# Retrieve the API key from environment variables (configuration: https://docs.byteplus.com/en/docs/ModelArk/1399008)
api_key = os.getenv('ARK_API_KEY')

# Initialize the client and enable MCP
client = Ark(
    base_url='https://ark.ap-southeast.bytepluses.com/api/v3',
    api_key=api_key
)

# Send a basic MCP call request
response = client.responses.create(
    model="seed-2-0-lite-260228",
    tools=[
        {
            "type": "mcp",
            "server_label": "deepwiki",
            "server_url": "https://mcp.deepwiki.com/mcp",
            "require_approval": "never"
        }
    ],
    input=[
        {
            "role": "user",
            "content": [
                {
                    "type": "input_text",
                    "text": "Check the documentation for the byteplus/ai-app-lab repository."
                }
            ]
        }
    ],
    extra_headers={"ark-beta-mcp": "true"},
    stream=True  # Stream results
)

# Print the response
for chunk in response:
    if hasattr(chunk, 'delta'):
        print(chunk.delta, end="", flush=True)
```



</Tab>
<Tab zoneid="g60w5Ez54V" title="OpenAI Python SDK">
<TabTitle>OpenAI Python SDK</TabTitle>

```Python
from openai import OpenAI
import os

# Retrieve the API key from environment variables (configuration: https://docs.byteplus.com/en/docs/ModelArk/1399008)

api_key = os.getenv('ARK_API_KEY')

# Initialize the client and enable MCP

client = OpenAI(
    base_url='https://ark.ap-southeast.bytepluses.com/api/v3',
    api_key=api_key,
    default_headers={"ark-beta-mcp": "true"}
)

# Send a basic MCP call request

response = client.responses.create(
    model="seed-2-0-lite-260228",
    tools=[
        {
            "type": "mcp",
            "server_label": "deepwiki",
            "server_url": "https://mcp.deepwiki.com/mcp",
            "require_approval": "never"
        }
    ],
    input=[
        {
            "role": "user",
            "content": [
                {
                    "type": "input_text",
                    "text": "Check the documentation for the byteplus/ai-app-lab repository."
                }
            ]
        }
    ],
    stream=True  # Stream results
)

# Print the response

for chunk in response:
    if hasattr(chunk, 'delta'):
        print(chunk.delta, end="", flush=True)

```



</Tab>
</Tabs>


<span id="fbb0c550"></span>
### Example 2: Multi\-turn MCP invocation

**Scenario**: Analyze live\-stream data via Qianchuan MCP; run after user approval and allow multi\-round follow\-up queries.


<Tabs>
<Tab zoneid="eBuhQDHzTc" title="Python SDK">
<TabTitle>Python SDK</TabTitle>

```Python
from byteplussdkarkruntime import Ark
import os

api_key = os.getenv('ARK_API_KEY')
client = Ark(
    base_url='https://ark.ap-southeast.bytepluses.com/api/v3',
    api_key=api_key
)

# 1. First round request: submit MCP invocation for approval
first_response = client.responses.create(

    model="seed-2-0-lite-260228",
    tools=[

        {
            "type": "mcp",
            "server_label": "qianchuan-mcp",
            "server_url": "https://mcp.qianchuan.com/mcp",
            "require_approval": "always"
        }
    ],
    input=[

        {
            "role": "user",
            "content": [{"type": "input_text", "text": "Analyze today's live broadcast bidding promotion data"}]
        }
    ],
    extra_headers={"ark-beta-mcp": "true"},
    stream=True
)

# Extract the approval ID and the previous round's response ID
last_chunk = None
for chunk in first_response:
    last_chunk = chunk
previous_response_id = last_chunk.response.id
approval_id = last_chunk.response.output[-1].id
print(f"Previous round response ID: {previous_response_id}, Approval ID: {approval_id}")

# 2. Second round request: approve and continue execution
second_response = client.responses.create(

    model="seed-2-0-lite-260228",
    tools=[
        {
            "type": "mcp",
            "server_label": "qianchuan-mcp",
            "server_url": "https://mcp.qianchuan.com/mcp",
            "require_approval": "always"
        }
    ],
    input=[
        {
            "type": "mcp_approval_response",
            "approve": True,  # Approve the request
            "approval_request_id": approval_id
        }
    ],
    extra_headers={"ark-beta-mcp": "true"},
    previous_response_id=previous_response_id,  # Associate with the previous round's request
    stream=True
)

# Print the second round response results
for chunk in second_response:
    if hasattr(chunk, 'delta'):
        print(chunk.delta, end="", flush=True)
```



</Tab>
</Tabs>


<span id="08cce921"></span>
## Parameter description

For details, see [Create a Responses model request](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request).

<span id="21743536"></span>
## Supported models

For details, see [Tool use](https://docs.byteplus.com/en/docs/ModelArk/1330310#243969e9).

> Model invocation requires the MCP service to be enabled and the relevant model permissions to be approved. Users without access cannot trigger MCP tool functionality.


<span id="5f8e1afb"></span>
## Precautions


1. **Invocation scope**: Cloud\-deployed MCP/Remote MCP can be invoked **only via the Responses API**, and **only** over MCP **Streamable HTTP** endpoints.

2. **Function name conflicts**: If a user\-defined function has the same name as a built\-in MCP tool (e.g., `mcp_call`), the model automatically determines call priority—no additional configuration is required.

3. **Default rate limits**: The account\-level default is `1000 RPM` (requests per minute). Exceeding this limit will cause requests to fail; submit a ticket to request an adjustment.


<span id="2bfd27e5"></span>
## Billing

Charges apply to base model token consumption only. No additional fees are incurred for MCP tool calls.




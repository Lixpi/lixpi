The context editing feature manages chain\-of\-thought content and tool call content within the context, offering the following benefits:


* Improved tool usage effectiveness: Allows the model to leverage reasoning content from historical context, improving the accuracy of tool triggering and usage.

* Context window management: Automatically keeps content within the model’s context window limits.

* Intelligent caching: Works in conjunction with the caching feature to optimize overall performance.


<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>


<div data-tips="true" data-tips-type="tip">This capability is still in the beta phase. Proceed with caution when using it in the production environment.</div>


<span id="d6c6c029"></span>
# Supported models


* seed\-2\-0\-pro\-260328

* seed\-2\-0\-lite\-260228

* seed\-2\-0\-mini\-260215

* seed\-2\-0\-code\-preview\-260328

* seed\-1\-8\-251228


<span id="b8d655bb"></span>
# API documentation

[Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request)

<span id="53274bbd"></span>
# Supported strategies


<span aceTableMode="list" aceTableWidth="1,1,3"></span>
|**Strategy** |**Identifier** |**Description** |
|---|---|---|
|Clear chain\-of\-thought content |`clear_thinking` |* Manages chain\-of\-thought content when the thinking feature is enabled.<br><br>* Automatically clears older chain\-of\-thought content from previous rounds. |
|Clear tool call content |`clear_tool_uses` |* Clears tool call content when the dialogue context grows beyond the configured threshold.<br><br>* Automatically clears older tool call content from previous rounds. |


<span id="d44abb15"></span>
# Clear chain\-of\-thought content

<span id="c4a97c35"></span>
## Configuration

The `clear_thinking` strategy supports the following configuration:


<span aceTableMode="list" aceTableWidth="1,1,2,1"></span>
|**Configuration** |**Type** |**Default Value** |**Description** |
|---|---|---|---|
|keep |Object / String |`{type: "thinking_turns", value: 1}` |Defines the chain\-of\-thought retention strategy. |


> The retention strategy applies to both tool\-call and non\-tool\-call scenarios and is determined solely by the number of turns.


For example:


* Retain the most recent N rounds of chain\-of\-thought content (N must be \> 0):

   ```JSON
   // Retain the most recent N rounds of chain-of-thought content
   {
       "type": "clear_thinking",
       "keep": {
           "type": "thinking_turns",
           "value": 3
       }
   }
   ```
   

* Retain all chain\-of\-thought content:

   ```Bash
   {
       "type": "clear_thinking",
       "keep": "all"
   }
   ```
   


<span id="26061490"></span>
## Example usage


<Tabs>
<Tab zoneid="ht5LqH2GtQ" title="cURL">
<TabTitle>cURL</TabTitle>

```Bash
curl https://ark.ap-southeast.bytepluses.com/api/v3/responses \\
    -H "Authorization: Bearer $ARK_API_KEY" \\
    -H "Content-Type: application/json" \\
    -d '{
        "model": "seed-2-0-lite-260228",
        "input": "Differences between reasoning and non-reasoning models",
        "thinking":{"type": "enabled"},
        "context_management": {
            "edits": [
                {
                    "type": "clear_thinking",
                    "keep": {
                        "type": "thinking_turns",
                        "value": 3
                    }
                }
            ]
        }
    }'
```



</Tab>
</Tabs>


<span id="f46ff0c8"></span>
# Clear tool call content

<span id="3ec28f05"></span>
## Configuration

The `clear_tool_uses` strategy supports the following configuration:


<span aceTableMode="list" aceTableWidth="1,1,1,3"></span>
|**Configuration** |**Type** |**Default Value** |**Description** |
|---|---|---|---|
|trigger |Object |N/A |Threshold for triggering the tool call content clearing strategy. |
|keep |Object |3 rounds of tool invocation |Retains the content of the most recent N rounds of tool calls. |
|exclude_tools |Array |N/A |List of tool names that will not be cleared, used to preserve important context. |
|clear_tool_input |Bool |false |Whether to clear the parameters of tool calls. |


For example:

```JSON
{
    "type": "clear_tool_uses",
    "trigger": {
        "type": "tool_uses",
        "value": 5
    },
    "keep": {
        "type": "tool_uses",
        "value": 3
    },
    "exclude_tools": [
        "web_search"
    ]
}
```


<span id="22e63008"></span>
## Usage example


<Tabs>
<Tab zoneid="zDbo0X7VbV" title="cURL">
<TabTitle>cURL</TabTitle>

```Bash
curl https://ark.ap-southeast.bytepluses.com/api/v3/responses \\
    -H "Authorization: Bearer $ARK_API_KEY" \\
    -H "Content-Type: application/json" \\
    -d '{
        "model": "seed-2-0-lite-260228",      
        "input": [
            {
                "role": "system",
                "content": "You are an AI assistant."                
            },
            {
                "role": "user",
                "content": "What is the weather like in New York today?"  
            }
        ],
        "thinking":{"type": "enabled"},
        "tools": [
            {
                "type": "function",
                "name": "get_weather",
                "description": "Search for the weather (including temperature and weather conditions) of a city for the current day based on its name.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "location": {
                            "type": "string",
                            "description": "City names, such as Beijing and Shanghai (only supports prefecture-level cities in China)"
                        }
                    },
                    "required": ["location"]
                }
            }
        ],
        "context_management": {
            "edits": [
                {
                    "type": "clear_tool_uses",
                    "trigger": {
                        "type": "tool_uses",
                        "value": 5
                    }
                }
            ]
        }
    }'
```



</Tab>
</Tabs>


<span id="f11b5c06"></span>
# Combine the two strategies

Chain\-of\-thought content and tool call content can be cleared simultaneously under the following rules:


* Order in the request: `clear_thinking` must be placed before `clear_tool_uses`.

* Processing order: Clear chain\-of\-thought content first, and then clear tool call content.



<Tabs>
<Tab zoneid="fdDBqqmaaV" title="cURL">
<TabTitle>cURL</TabTitle>

```Bash
curl https://ark.ap-southeast.bytepluses.com/api/v3/responses \\
    -H "Authorization: Bearer $ARK_API_KEY" \\
    -H "Content-Type: application/json" \\
    -d '{
        "model": "seed-2-0-lite-260228",
        "input": [
            {
                "role": "system",
                "content": "You are an AI assistant."  
            },
            {
                "role": "user",
                "content": "What is the weather like in New York today?"  
            }
        ],
        "thinking":{"type": "enabled"},
        "tools": [
            {
                "type": "function",
                "name": "get_weather",
                "description": "Search for the weather (including temperature and weather conditions) of a city for the current day based on its name.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "location": {
                            "type": "string",
                            "description": "City names, such as Beijing and Shanghai"
                        }
                    },
                    "required": ["location"]
                }
            }
        ],
        "context_management": {
            "edits": [
                {
                    "type": "clear_thinking",
                    "keep": {
                        "type": "thinking_turns",
                        "value": 3
                    }
                },
                {
                    "type": "clear_tool_uses",
                    "trigger": {
                        "type": "tool_uses",
                        "value": 5
                    }
                }
            ]
        }
    }'
```



</Tab>
</Tabs>





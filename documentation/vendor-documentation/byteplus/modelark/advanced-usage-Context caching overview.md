In scenarios with large amounts of repeated context input such as multi\-turn conversations, tool calls, and role\-playing, context caching reuses computation results to avoid repeated processing of the same content by the model. This eliminates repeated\-loading overhead and can significantly reduce token costs.

<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>


<div data-tips="true" data-tips-type="tip">If you're new to ModelArk, see <a href="https://docs.byteplus.com/en/docs/ModelArk/1399008">Quick start</a> to get up and running quickly.</div>


<span id="dc271b0a"></span>
# Cache modes

Context caching supports two working modes, which can be selected based on convenience, determinism, and cost requirements.


* **Implicit cache**: An **automatically enabled** mode that requires no additional configuration from users and cannot be turned off, suitable for general purposes where convenience is a priority. The system will automatically identify the common prefix in requests and cache it, but does not guarantee cache hits.

* **Explicit cache**: A caching mode that needs to be **manually enabled**. It requires manual creation and configuration of cache and supports deterministic hits.


<div data-tips="true" data-tips-type="warning" data-tips-is-title="true">Note</div>


<div data-tips="true" data-tips-type="warning">Implicit cache requires no configuration and is automatically enabled by the system. When a request uses explicit cache, the implicit cache does not take effect.</div>



<span aceTableMode="list" aceTableWidth="2,3,3"></span>
|Comparison item |Implicit cache |Explicit cache |
|---|---|---|
|Configuration method |No configuration required, cannot be disabled. |Requires explicit configuration |
|Impact on response |No impact |No impact |
|Supported APIs |[Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request)<br><br>[Chat API](https://docs.byteplus.com/en/docs/ModelArk/1494384)<br><br>[Batch API](https://docs.byteplus.com/zh-CN/docs/ModelArk/1528783) |[Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request)<br><br>[Context caching conversation API](https://docs.byteplus.com/en/docs/ModelArk/1346560) |
|Cache hit |Cache hits are not guaranteed; the specific hit probability is determined by the system. |Deterministic hits (higher cache hit rate) |
|Cache lifetime |Not fixed; the system does not guarantee the cache lifetime. |Supports configuring cache expiration time |
|Minimum number of tokens for caching |1024 |* Responses API prefix caching: 256<br><br>* Other cache types: No limit |
|Billing for input tokens that hit the cache |Tiered billing based on model input length |Tiered billing based on model input length |
|Cache storage billing |No charge |Charged |


&nbsp;

<span id="1dfad02a"></span>
# Implicit cache

<span id="6024bcd0"></span>
## Supported models

Models that support implicit cache are listed below. For details, see [Context caching](https://docs.byteplus.com/en/docs/ModelArk/1330310#476e6f25).


* For online inference, Dola Seed 2.0 and later series models support implicit cache, and this feature cannot be disabled.

* For batch inference, implicit cache is enabled for supported models and cannot be disabled.


<span id="8c7c47d5"></span>
## How it works

When sending a request to a model that supports implicit caching, this feature is automatically enabled, and here is how it works:


* **Cache creation**: The system caches based on the **common prefix** of the request input. After a request completes inference, the system may write the reusable **prefix segment** from its input into the cache, so that subsequent requests can reuse it when the **same prefix** appears.

* **Cache hit**: When the input of a subsequent request has the **same prefix** as an existing cache entry, the system will try to reuse the cache result corresponding to this prefix, thereby reducing repeated calculations.

   * No guarantee of hit: Cache capacity is limited, and old caches may be evicted; distributed routing also affects the hit probability.

   * No guarantee of longest prefix hit: The system comprehensively considers available resources and hit benefits; the hit length may not be the globally longest hit segment.

* **Cache hit condition**: A cache block must be at least 1024 tokens long to be recognized by the system and participate in hit matching. That is, the request input must be at least 1024 tokens long to potentially trigger a cache hit.


<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>


<div data-tips="true" data-tips-type="tip">You can determine whether implicit cache is hit through the API response parameter <code>usage.prompt_tokens_details</code>:</div>



* <div data-tips="true" data-tips-type="tip">Hit: <code>cached_tokens > 0</code></div>


* <div data-tips="true" data-tips-type="tip">Missed: <code>cached_tokens = 0</code></div>



<span id="e594a3bd"></span>
## Billing

When a request hits implicit cache, the billing rule is as follows:


* Hit input tokens (`cached_tokens`): Billed at the cache hit input unit price.

* Missed input tokens: Billed at the normal input unit price.

* Output tokens: Billed at the normal output unit price.

* Cache storage: No charge.


<div data-tips="true" data-tips-type="warning" data-tips-is-title="true">Note</div>



* <div data-tips="true" data-tips-type="warning">Compared with explicit cache, <strong>implicit cache storage is free of charge</strong>.</div>


* <div data-tips="true" data-tips-type="warning"><strong>The cache hit input unit price may change with the context input length range</strong>. For example, the cache hit input unit price of the Seed 2.0 series models varies when the input length is [0, 32k], [32k, 128k], or [128k, 256k].</div>



<span id="3ae7305f"></span>
## Limitations

Implicit cache only works when models that support this feature are called via Responses API, Chat API or Batch API.

<span id="862f8af1"></span>
## Best practices


* Prompt organization: Place static or repeated content at the beginning of the prompt and dynamic or differential content at the end.

* Continuously and stably send requests with the same prompt prefix to reduce the probability of cache eviction and maximize cache benefits.

* Monitor the number of tokens that hit the cache by recording the API response parameter `usage.prompt_tokens_details`, and then analyze and optimize the caching strategy.


<span id="c1d112aa"></span>
# Explicit cache

Compared with implicit cache, explicit cache needs to be explicitly created but can achieve a higher cache hit rate (deterministic hits).

<span id="e8535e58"></span>
## Supported models

For models and APIs that support explicit cache, see [Context caching](https://docs.byteplus.com/en/docs/ModelArk/1330310#476e6f25).

<span id="2ef90d43"></span>
## How it works

Explicit cache supports two types: Session caching and prefix caching.

<span id="0b8d3b3d"></span>
### Session caching

**Stores initial information** and **dynamically updates the cache with each turn of conversation**. In a new turn of requests, the cache information and input information are sent to the model together for inference. It is suitable for scenarios such as multi\-turn conversations and multi\-turn tool calls.


<span aceTableMode="list" aceTableWidth="5,2"></span>
|Diagram |Note |
|---|---|
|<span>![图片](https://asset.ark-doc-resources.com/flowcharts/advanced-usage/principles-and-selection-02.svg) </span> |1. When a user creates a cache, ModelArk processes the information into tokens that can be directly used for model inference, stores them in the cache, and generates an ID as the Key.<br><br>2. ModelArk receives a new request, calculates the tokens of the new input, retrieves the corresponding information tokens based on the cache ID in the request, concatenates them, and inputs them to the model for inference.<br><br>3. The model returns information, and ModelArk **stores the tokens of the response information into the cache** for use in the next request. |


<span id="b33acdd2"></span>
### Prefix caching

It stores the initial information that does not need to be updated in each turn of conversation. Suitable for repeated use scenarios of static prompt templates such as standardized conversation openings, specific task instructions, rule\-based templates, and in\-depth analysis of ultra\-long texts.


<span aceTableMode="list" aceTableWidth="5,2"></span>
|Diagram |Note |
|---|---|
|<span>![图片](https://asset.ark-doc-resources.com/flowcharts/advanced-usage/principles-and-selection-03.svg) </span> |1. When a user creates a cache, ModelArk processes the information into tokens that can be directly used for model inference, stores them in the cache, and generates an ID as the Key.<br><br>2. ModelArk receives a new request, calculates the tokens of the new input, retrieves the corresponding information tokens based on the cache ID in the request, concatenates them, and inputs them to the model for inference.<br><br>3. The model outputs response information, and there is no need to update the information in the cache. |


<span id="9cb05d57"></span>
## Calling methods and comparison

The platform provides two APIs to implement explicit cache. Since each model supports at most one caching API, the API that can be used is determined once you select the model.

The following table briefly compares the calling methods and core differences of these two APIs. You can refer to the corresponding API tutorials for detailed calling instructions and code examples.


<span aceTableMode="list" aceTableWidth="2,4,4"></span>
|API |[Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request) |[Create context caching API](https://docs.byteplus.com/en/docs/ModelArk/1346559) |
|---|---|---|
|Tutorial |[Context caching (Responses API)](https://docs.byteplus.com/en/docs/ModelArk/1602228) |[Context caching (Context API)](https://docs.byteplus.com/en/docs/ModelArk/1396491) |
|Supported models |[Context caching](https://docs.byteplus.com/en/docs/ModelArk/1330310#476e6f25) |[Context caching](https://docs.byteplus.com/en/docs/ModelArk/1330310#476e6f25) |
|Procedure |1. Cache information: Configure `"caching": {"type": "enabled"}` during a conversation to create a session cache, or configure `"caching":{"type": "enabled", "prefix": true}` to create a prefix cache, which stores the current conversation content in the cache. Obtain the ID value from the returned information.<br><br>2. Use cache: Configure `"previous_response_id":"<ID>"` to use the cache information in this turn of conversation.<br><br>   * Session caching: Configure `"caching": {"type": "enabled" }` each time you use the cache. **The information of the current turn is also updated to the cache, and a new ID is generated.**  Use the ID returned by this call in the next call.<br><br>* Prefix caching: No need to configure `"caching": {"type": "enabled" }`; just set `previous_response_id` to the fixed cache ID. |1. Cache information: Use [Create context caching API](https://docs.byteplus.com/en/docs/ModelArk/1346559) to create cache information and specify the cache type (session caching or prefix caching). Obtain the cache ID value from the returned information.<br><br>2. Use cache: Configure `"context_id":"<ID>"` through [Context caching conversation API](https://docs.byteplus.com/en/docs/ModelArk/1346560) to use the cache information in this turn of conversation.<br><br>   * Session caching: Each time you use the cache, **update the information of the current turn to the cache**. No new ID is generated. You can continue to use the original cache ID in the next call.<br><br>   * Prefix caching: Use fixed cache information each time. |
|Retain initial information |Yes<br><br>Flexible control: You can delete the cache information from any turn to control the initial content. |Yes<br><br>Not controllable; once written, it cannot be changed. |
|Cache charging items |Cache storage fee and input hit cache fee (discount). |Cache storage fee and input hit cache fee (discount). |
|Cacheable media |Supports caching of multimodal (text, image, video, etc.) inputs and tool call information. |Only supports text caching. |
|Change cached content |Session caching: Supports updating cache information; a new cache ID will be generated.<br><br>Prefix caching: Not supported and no update needed. |Session caching: Supports updating cache information; the cache ID remains unchanged.<br><br>Prefix caching: Not supported and no update needed. |
|Call previous cache information |Supported; use previous cache ID. |Session caching: Not supported; after creating the cache, the ID remains unchanged. When content is updated, past content will be overwritten.<br><br>Prefix caching: Not applicable; content is immutable. |
|Manually delete cache information |Supported<br><br>You can delete cache information of any ID |Not supported<br><br>Automatically deleted when expired |
|Cache retention period |Supports configuring expiration time.<br><br>Supported maximum value is current time + 604800 seconds in the format of UTC UNIX timestamp (unit: seconds), namely retaining for 7 days from creation. |Supports configuring TTL.<br><br>Configurable when creating the cache; maximum 168 hours. |
|Expiration mechanism |Configures the expiration time point; the cache expires at the corresponding time point. The life cycle is not reset with the use of the cache/storage.<br><br>After storage and cache expire, you need to use [Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request) to recreate the storage/cache content. |Configures the retention duration; the calculation formula is:<br><br>`Current time - Last cache usage time`<br><br>If the cache is not used within the TTL period, it expires. The cache is reactivated after use, and the life cycle is reset. |
|Maximum cache length |Yes<br><br>Maximum context window |Yes<br><br>Maximum context window \- Maximum output length |
|Triggering maximum cache length |If the maximum cache length is exceeded during creation, an error will be reported.<br><br>Among them, session caching will report an error if the length limit is exceeded during update. |If the maximum cache length is exceeded during creation, an error will be reported.<br><br>Among them, session caching will automatically delete historical messages if the length limit is exceeded during update. |





Features and unit prices vary with model services. This topic introduces the billing formulas and unit prices for each model to help you check and compare model prices.

<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>


<div data-tips="true" data-tips-type="tip">To learn about the billing method and detailed billing rules, see <a href="https://docs.byteplus.com/en/docs/ModelArk/1544681">Model service billing</a>.</div>


<span id="741ab123"></span>
# Large language models

<span id="44651b79"></span>
## Online inference (standard)


<span aceTableMode="list" aceTableWidth="1,1,1,1,1,1,1,1"></span>
|**Model ID** |**Pricing tiers**<br><br>(K tokens) |**Input (non\-audio)** <br><br>(USD / M tokens) |**Input (audio)** <br><br>(USD / M tokens) |**Cache\-storage**<br><br>(USD / M tokens / Hour) |**Cache\-hit input (non\-audio)** <br><br>(USD / M tokens) |**Cache\-hit input (audio)** <br><br>(USD / M tokens) |**Output**<br><br>(USD / M tokens) |
|---|---|---|---|---|---|---|---|
|seed\-2\-0\-lite\-260428 |Prompt length [0, 128] |0.25 |3.75 |0.0083 |0.05 |0.75 |2.00 |
||Prompt length (128, 256] |0.50 |7.50 |0.0083 |0.10 |1.50 |4.00 |
|seed\-2\-0\-mini\-260428 |Prompt length [0, 128] |0.10 |1.50 |0.0083 |0.02 |0.30 |0.40 |
||Prompt length (128, 256] |0.20 |3.00 |0.0083 |0.04 |0.60 |0.80 |
|seed\-2\-0\-pro\-260328 |Prompt length [0, 128] |0.50 |\- |0.0083 |0.10 |\- |3.00 |
||Prompt length (128, 256] |1.00 |\- |0.0083 |0.20 |\- |6.00 |
|seed\-2\-0\-lite\-260228 |Prompt length [0, 128] |0.25 |\- |0.0083 |0.05 |\- |2.00 |
||Prompt length (128, 256] |0.50 |\- |0.0083 |0.10 |\- |4.00 |
|seed\-2\-0\-mini\-260215 |Prompt length [0, 128] |0.10 |\- |0.0083 |0.02 |\- |0.40 |
||Prompt length (128, 256] |0.20 |\- |0.0083 |0.04 |\- |0.80 |
|seed\-2\-0\-code\-preview\-260328 |Prompt length [0, 128] |0.50 |\- |0.0083 |0.10 |\- |3.00 |
||Prompt length (128, 256] |1.00 |\- |0.0083 |0.20 |\- |6.00 |
|seed\-1\-8\-251228 |Prompt length [0, 128] |0.25 |\- |0.0083 |0.05 |\- |2.00 |
||Prompt length (128, 256] |0.50 |\- |0.0083 |0.05 |\- |4.00 |
|glm\-4\-7\-251222 |\- |0.6 |\- |0.0083 |0.11 |\- |2.2 |
|deepseek\-v4\-pro\-260425 |\- |1.74 |\- |0.0083 |0.145 |\- |3.48 |
|deepseek\-v4\-flash\-260425 |\- |0.14 |\- |0.0083 |0.028 |\- |0.28 |
|deepseek\-v3\-2\-251201 |Prompt length [0, 32] |0.28 |\- |0.0083 |0.056 |\- |0.42 |
||Prompt length (32, 128] |0.56 |\- |0.0083 |0.056 |\- |0.84 |
|seed\-1\-6\-250915 |Prompt length [0, 128] |0.25 |\- |0.0083 |0.05 |\- |2.00 |
||Prompt length (128, 256] |0.50 |\- |0.0083 |0.05 |\- |4.00 |
|seed\-1\-6\-flash\-250715 |Prompt length [0, 128] |0.075 |\- |0.0083 |0.015 |\- |0.30 |
||Prompt length (128, 256] |0.10 |\- |0.0083 |0.015 |\- |0.80 |
|gpt\-oss\-120b\-250805 |\- |0.10 |\- |\- |\- |\- |0.5 |



> * Pay\-as\-you\-go by token. Calculation formula:

>    * `Online inference cost = Input unit price × Input tokens + Cached input unit price × Cache hit tokens + Cache storage unit price × Cache storage tokens × Duration + Output unit price × Output tokens`

> * Tiered billing: Applicable to some models. Token unit prices vary for different prompt lengths (and output lengths):

>    * Example: A request with 200k input tokens and 14k output tokens falls in the range of **prompt length (128, 256]** , so the model's input and output tokens are billed at: 0.25 USD per million tokens for input, 2 USD per million tokens for output.


<span id="f9bc1208"></span>
## Batch inference


<span aceTableMode="list" aceTableWidth="1,1,1,1,1"></span>
|**Model ID** |**Pricing tiers**<br><br>(K Tokens) |**Input**<br><br>(USD / M tokens) |**Cache\-hit input**<br><br>(USD / M tokens ) |**Output**<br><br>(USD / M tokens) |
|---|---|---|---|---|
|seed\-2\-0\-pro\-260328 |Prompt length [0, 128] |0.25 |0.10 |1.50 |
||Prompt length (128, 256] |0.50 |0.20 |3.00 |
|seed\-2\-0\-lite\-260228 |Prompt length [0, 128] |0.125 |0.05 |1.00 |
||Prompt length (128, 256] |0.25 |0.10 |2.00 |
|seed\-2\-0\-mini\-260215 |Prompt length [0, 128] |0.05 |0.02 |0.20 |
||Prompt length (128, 256] |0.10 |0.04 |0.40 |
|seed\-1\-8\-251228 |Prompt length [0, 128] |0.125 |0.05 |1.00 |
||Prompt length (128, 256] |0.25 |0.05 |2.00 |
|seed\-1\-6\-250915 |Prompt length [0, 128] |0.125 |0.05 |1.00 |
||Prompt length (128, 256] |0.25 |0.05 |2.00 |
|seed\-1\-6\-flash\-250715 |Prompt length [0, 128] |0.0375 |0.015 |0.15 |
||Prompt length (128, 256] |0.05 |0.015 |0.40 |
|glm\-4\-7\-251222 |\- |0.3 |0.11 |1.1 |
|deepseek\-v4\-pro\-260425 |\- |0.87 |0.145 |1.74 |
|deepseek\-v4\-flash\-260425 |\- |0.07 |0.028 |0.14 |



> * Pay\-as\-you\-go by token. Calculation formula: `Batch inference cost = Input unit price × Input tokens + Cache hit unit price × Cache hit tokens + Output unit price × Output tokens`

> * Some models support transparent prefix caching. For these models, no configuration is required, and you can enjoy lower unit prices after cache hits.

> * seed\-1\-6 series supports tiered pricing, that is, different token unit prices are adopted according to the input and output length of each request.

>    * Example: A request with 200k input tokens and 14k output tokens falls in the range of **prompt length (128, 256]** , so the model's input and output tokens are billed at: 0.25 USD per million tokens for input, 2 USD per million tokens for output.


<span id="8f25f772"></span>
# Video generation models

<div data-tips="true" data-tips-type="warning" data-tips-is-title="true">warning</div>


<div data-tips="true" data-tips-type="warning">Video pricing is determined by both the <strong>token rate</strong> and <strong>token consumption</strong>. Under otherwise identical conditions:</div>



* <div data-tips="true" data-tips-type="warning">A video generated at a higher resolution costs more than one generated at a lower resolution.</div>


* <div data-tips="true" data-tips-type="warning">A video generated with video input costs more than one generated without video input.</div>



<div data-tips="true" data-tips-type="warning">You can use the <a href="https://bytedance.larkoffice.com/share/base/form/shrcnIHSU1yg0GtzCX4pyW3g3yb">Seedance 2.0 Series Pricing Calculator</a> to estimate the cost of each video. For typical pricing scenarios, see the <a href="https://docs.byteplus.com/en/docs/ModelArk/1544106#0c3cd17c">pricing examples</a> below.</div>


<span id="28d5ad67"></span>
## Pricing


<span aceTableMode="list" aceTableWidth="2,2,1"></span>
|**Model ID** |**Online inference**<br><br>(USD / M tokens) |**Offline inference**<br><br>(USD / M tokens) |
|---|---|---|
|dreamina\-seedance\-2\-0\-260128<br><br>> Pricing varies based on output video resolution and whether the input includes video. |* For 480p and 720p outputs:<br><br>   * Input without video: 7.0<br><br>   * Input with video: 4.3<br><br>* For 1080p outputs:<br><br>   * Input without video: 7.7<br><br>   * Input with video: 4.7<br><br>* For 4k outputs:<br><br>   * Input without video: 4.0<br><br>   * Input with video: 2.4 |Not supported yet |
|dreamina\-seedance\-2\-0\-fast\-260128<br><br>> Pricing varies based on whether the input includes video. 1080p output is not supported. |* Input without video: 5.6<br><br>* Input with video: 3.3 |Not supported yet |
|dreamina\-seedance\-2\-0\-mini\-260615<br><br>> Pricing varies based on whether the input includes video. 1080p output is not supported. |* Input without video：3.5<br><br>* Input with video: 2.1 |Not supported yet |
|seedance\-1\-5\-pro\-251215<br><br>> Pricing varies based on whether the output includes audio |* Video with audio: 2.4<br><br>* Video without audio: 1.2 |* Video with audio: 1.2<br><br>* Video without audio: 0.6 |
|seedance\-1\-0\-pro\-250528 |2.5 |1.25 |
|seedance\-1\-0\-pro\-fast\-251015 |1 |0.5 |



> * You are only charged for successfully generated videos. No fee is charged if generation fails due to reasons such as content moderation.

> * Estimated video price: `Token unit price × Token consumption`

> * Estimated token consumption = `(Input video duration + Output video duration) × Output video width × Output video height × Output video frame rate / 1024`

>    * Some models support draft mode (generates low\-quality draft videos for quick test). Token consumption is lower in this mode, and the calculation formula is `Estimated token consumption × Conversion factor`. The conversion factor varies by model. For Seedance 1.5 Pro, the token conversion factors are: 0.7 for silent videos, 0.6 for audio videos. Other models do not support this mode for now.

>    * The above token consumption values are all estimates. The actual token consumption is subject to the usage. **completion_tokens** parameter returned after the API call.


<span id="0c3cd17c"></span>
## Price examples

The following are some estimated prices based on estimated token usage. You can get a general idea of video generation costs for different specifications.

<span id="fce02465"></span>
### Dreamina Seedance 2.0 & 2.0 Fast & Mini

Use the [Price Calculator - SD 2.0](https://bytedance.larkoffice.com/share/base/form/shrcnIHSU1yg0GtzCX4pyW3g3yb) to get more estimated prices.


> * Video price estimation formula: `Token unit price × Token consumption` = `Token unit price × (Input video duration + Output video duration) × Output video width × Output video height × Output video frame rate / 1024`

> * Note: When the input includes video, Dreamina Seedance 2.0 and Dreamina Seedance 2.0 Fast models have minimum token consumption limits:

>    * If the estimated token consumption is less than the minimum token consumption limit, the video price is calculated based on the minimum token consumption.

>    * The minimum token consumption is related to resolution, aspect ratio, and video output duration. You can use the [Minimum token usage lookup sheet (estimated value)](https://bytedance.larkoffice.com/wiki/RQvpwKAGZiFim9kj92mcuAnZnTb) or [Price Calculator - SD 2.0](https://bytedance.larkoffice.com/share/base/form/shrcnIHSU1yg0GtzCX4pyW3g3yb) to estimate the minimum token consumption for your video generation tasks. The actual token consumption is subject to the `usage.completion_tokens` field returned after the API call..

* **Input without video**



<span aceTableMode="list" aceTableWidth="3,1,1,1,"></span>
|**Resolution** |**480p** |**720p** |**1080p** |**4k** |
|---|---|---|---|---|
|Aspect ratio |16:9 |16:9 |16:9 |16:9 |
|Output video duration (seconds) |5 |5 |5 |5 |
|Dreamina Seedance 2.0 (USD) |* 0.35 per video<br><br>* 0.07 per second |* 0.76 per video<br><br>* 0.15 per second |* 1.87 per video<br><br>* 0.37 per second |* 3.89 per video<br><br>* 0.78 per second |
|Dreamina Seedance 2.0 Fast (USD) |* 0.28 per video<br><br>* 0.06 per second |* 0.60 per video<br><br>* 0.12 per second |Not supported |Not supported |
|Dreamina Seedance 2.0 Mini (USD) |* 0.18 per video<br><br>* 0.04 per second |* 0.38 per video<br><br>* 0.08 per second |Not supported |Not supported |



* **Input with video**



<span aceTableMode="list" aceTableWidth="1,1,1,1,"></span>
|**Resolution** |**480p** |**720p** |**1080p** |**4k** |
|---|---|---|---|---|
|Aspect ratio |16:9 |16:9 |16:9 |16:9 |
|Input video duration (seconds) |2–15 |2–15 |2–15 |2\-15 |
|Output video duration (seconds) |5 |5 |5 |5 |
|Dreamina Seedance 2.0 (USD per video) |0.39\-0.86<br><br>> Lowest price corresponds to 2–4 seconds input, highest price corresponds to 15 seconds input |0.84\-1.86<br><br>> Lowest price corresponds to 2–4 seconds input, highest price corresponds to 15 seconds input |2.06\-4.57<br><br>> Lowest price corresponds to 2–4 seconds input, highest price corresponds to 15 seconds input |4.20\-9.33<br><br>> Lowest price corresponds to 2–4 seconds input, highest price corresponds to 15 seconds input |
|Dreamina Seedance 2.0 Fast (USD per video) |0.30\-0.66<br><br>> Lowest price corresponds to 2–4 seconds input, highest price corresponds to 15 seconds input |0.64\-1.43<br><br>> Lowest price corresponds to 2–4 seconds input, highest price corresponds to 15 seconds input |Not supported |Not supported |
|Dreamina Seedance 2.0 Mini (USD per video) |0.19\-0.42<br><br>> Lowest price corresponds to 2–4 seconds input, highest price corresponds to 15 seconds input |0.41\-0.91<br><br>> Lowest price corresponds to 2–4 seconds input, highest price corresponds to 15 seconds input |Not supported |Not supported |


<span id="2902b370"></span>
### Seedance 1.5 Pro

To get more estimated prices, use the [Price Calculator - SD 1.5 Pro](https://bytedance.larkoffice.com/share/base/form/shrcneEuTYlLCqxyCR9IXElPVnc).


<span aceTableMode="list" aceTableWidth="2,2,2,3,3,3,3"></span>
|**Resolution** |**Aspect ratio** |**Duration**<br><br> **(seconds)**  |**Audio video**<br><br> **(USD per video)**  |**Draft audio video**<br><br> **(USD per video)**  |**Silent video**<br><br> **(USD per video)**  |**Draft silent video**<br><br> **(USD per video)**  |
|---|---|---|---|---|---|---|
|480p |16:9 |5 |0.12 |0.07 |0.06 |0.04 |
|720p |16:9 |5 |0.26 |Not supported |0.13 |Not supported |
|1080p |16:9 |5 |0.58 |Not supported |0.29 |Not supported |


<span id="08910d8b"></span>
### Seedance 1.0 Pro

To get more estimated prices, please use the [Price Calculator - SD 1.0 Pro](https://bytedance.larkoffice.com/share/base/form/shrcna8QRuYvU0vVl1YrRxfrkvg).


<span aceTableMode="list" aceTableWidth="1,1,2,1,1,1,1"></span>
|**Resolution** |**Ratio** |**Long Side × Short Side (px)**  |**Frame Rate**<br><br> **(frame/s)**  |**Duration**<br><br> **(second)**  |**Usage**<br><br> **(token)**  |**Price**<br><br> **(USD)**  |
|---|---|---|---|---|---|---|
|480p |16:9 |864×480 |24 |5 |48600 |0.12 |
||16:9 |864×480 |24 |10 |97000 |0.24 |
||4:3 |736×544 |24 |5 |46920 |0.12 |
||4:3 |736×544 |24 |10 |93840 |0.23 |
||1:1 |640×640 |24 |5 |48000 |0.12 |
||1:1 |640×640 |24 |10 |96000 |0.24 |
||21:9 |960×416 |24 |5 |46800 |0.12 |
||21:9 |960×416 |24 |10 |93600 |0.23 |
|720p |16:9 |1248×704 |24 |5 |102960 |0.26 |
||16:9 |1248×704 |24 |10 |205920 |0.51 |
||4:3 |1120×832 |24 |5 |109200 |0.27 |
||4:3 |1120×832 |24 |10 |218400 |0.55 |
||1:1 |960×960 |24 |5 |108000 |0.27 |
||1:1 |960×960 |24 |10 |216000 |0.54 |
||21:9 |1504×640 |24 |5 |112800 |0.28 |
||21:9 |1504×640 |24 |10 |225600 |0.56 |
|1080p |16:9 |1920×1088 |24 |5 |244800 |0.61 |
||16:9 |1920×1088 |24 |10 |489600 |1.22 |
||4:3 |1664×1248 |24 |5 |243360 |0.61 |
||4:3 |1664×1248 |24 |10 |486720 |1.22 |
||1:1 |1440×1440 |24 |5 |243000 |0.61 |
||1:1 |1440×1440 |24 |10 |486000 |1.22 |
||21:9 |2176×928 |24 |5 |236640 |0.59 |
||21:9 |2176×928 |24 |10 |473280 |1.18 |


<span id="cfc5822b"></span>
### Seedance 1.0 Pro Fast

To get more estimated prices, please use the [Price Calculator - SD 1.0 Pro](https://bytedance.larkoffice.com/share/base/form/shrcna8QRuYvU0vVl1YrRxfrkvg).


<span aceTableMode="list" aceTableWidth="1,1,2,1,1,1,1"></span>
|**Resolution** |**Ratio** |**Long Side × Short Side (px)**  |**Frame Rate**<br><br> **(frame/s)**  |**Duration**<br><br> **(second)**  |**Usage**<br><br> **(token)**  |**Price**<br><br> **(USD)**  |
|---|---|---|---|---|---|---|
|480p |16:9 |864×480 |24 |5 |48600 |0.05 |
||16:9 |864×480 |24 |10 |97000 |0.10 |
||4:3 |736×544 |24 |5 |46920 |0.05 |
||4:3 |736×544 |24 |10 |93840 |0.09 |
||1:1 |640×640 |24 |5 |48000 |0.05 |
||1:1 |640×640 |24 |10 |96000 |0.10 |
||21:9 |960×416 |24 |5 |46800 |0.05 |
||21:9 |960×416 |24 |10 |93600 |0.09 |
|720p |16:9 |1248×704 |24 |5 |102960 |0.10 |
||16:9 |1248×704 |24 |10 |205920 |0.21 |
||4:3 |1120×832 |24 |5 |109200 |0.11 |
||4:3 |1120×832 |24 |10 |218400 |0.22 |
||1:1 |960×960 |24 |5 |108000 |0.11 |
||1:1 |960×960 |24 |10 |216000 |0.22 |
||21:9 |1504×640 |24 |5 |112800 |0.11 |
||21:9 |1504×640 |24 |10 |225600 |0.23 |
|1080p |16:9 |1920×1088 |24 |5 |244800 |0.24 |
||16:9 |1920×1088 |24 |10 |489600 |0.49 |
||4:3 |1664×1248 |24 |5 |243360 |0.24 |
||4:3 |1664×1248 |24 |10 |486720 |0.49 |
||1:1 |1440×1440 |24 |5 |243000 |0.24 |
||1:1 |1440×1440 |24 |10 |486000 |0.49 |
||21:9 |2176×928 |24 |5 |236640 |0.24 |
||21:9 |2176×928 |24 |10 |473280 |0.47 |


<span id="c02be6ee"></span>
# Image generation models


<span aceTableMode="list" aceTableWidth="2,1"></span>
|**Model ID** |**Price (USD / image)**  |
|---|---|
|seedream\-5\-0\-lite\-260128 |0.035 |
|seedream\-4\-5\-251128 |0.04 |
|seedream\-4\-0\-250828 |0.03 |
|seededit\-3\-0\-i2i\-250628 |0.03 |



> * Billing is based on the number of successful output images:

>    * For batch generation scenarios, billing is based on the actual number of generated images.

>    * Images that are not successfully output due to reasons such as content moderation are not billed.


<span id="33538fff"></span>
# 3D generation models


<span aceTableMode="list" aceTableWidth="1,2,2"></span>
|**Model** |**Generation Mode** |**Price (USD / Call)**  |
|---|---|---|
|Hyper3d\-Gen2 |* White model<br><br>* Textured model<br><br>* PBR material model<br><br>* Textured model with PBR materials |0.399<br><br>> `30k tokens / call` \* `0.0133 USD/K tokens` |
|Hitem3d\-2.0 |Standard White Model |0.8<br><br>> `40k tokens / call` \* `0.020 USD/K tokens` |
||Standard Textured Model |1.4<br><br>> `70k tokens / call` \* `0.020 USD/K tokens` |
||High\-Precision White Model |1.2<br><br>> `60k tokens / call` \* `0.020 USD/K tokens` |
||High\-Precision Textured Model |1.8<br><br>> `90k tokens / call` \* `0.020 USD/K tokens` |


> Billing is based on the number of successfully output 3D files.


<span id="34ca905e"></span>
# Embedding vision models

> Input (including images) is converted into tokens for billing.

> Pay\-as\-you\-go pricing by token


```Plain
Inference Cost = 
    text input unit price × text token + 
    image input unit price × image input token
```


> Image tokens = (width px × height px)/784. Maximum token consumption per image is 1312 tokens.



<span aceTableMode="list" aceTableWidth="1,1,1,1.5,1,1"></span>
|**Model provider** |**Model** |**Service type** |**Unit price (USD / M tokens)**  |**Billing method** |**Free quota** |
|---|---|---|---|---|---|
|BytePlus |skylark\-embedding\-vision |Inference input (image) |0.325 |Postpaid |500K tokens |
|||Inference input (text) |0.125 |Postpaid ||


<span id="a4bfac4b"></span>
# Model unit

Model units are billed based on the selected machine type and usage duration, and pricing is independent of the model itself. You can flexibly combine **Postpaid (hourly)**  and **Prepaid (monthly)**  billing options.

The platform also provides a [Model Unit Calculator](https://console.byteplus.com/ark/region:ark+ap-southeast-1/endpoint/create) (available on the order page after login) to help you estimate the required machine types and quantities. It is strongly recommended to perform stress testing with real business traffic to accurately determine the appropriate machine specifications and capacity.

For more information about how to choose a plan, see [What are the differences between model units of different machine types? How to choose a machine type?](https://docs.byteplus.com/en/docs/ModelArk/1359411#112a7e97)

<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>


<div data-tips="true" data-tips-type="tip">This is a Beta capability only open to invited users. To use it, submit <a href="https://console.byteplus.com/workorder/create?step=2&SubProductID=P00001514">a test application ticket</a>.</div>



<span aceTableMode="list" aceTableWidth="1,1,1"></span>
|**Machine type** |**Billing method** |**Pricing (USD/Unit)**  |
|---|---|---|
|Flavor\-A |Postpaid (hourly) |4.20 |
||Prepaid (monthly) |2800.00 |
|Flavor\-C |Postpaid (hourly) |1.80 |
||Prepaid (monthly) |1300.00 |


<span id="2a2a6acd"></span>
# Rate limits

The call limits for each model are requests per minute (RPM) and tokens per minute (TPM). You can go to the [Model activation](https://console.byteplus.com/ark/region:ark+ap-southeast-1/openManagement) page to view the limits of each account (along with all its sub\-accounts).

To increase your limits, submit a request on the console.

<span id="a05784b7"></span>
# Service unavailability


* An account is considered in arrears when its balance becomes insufficient or falls below zero.

* If an account stays in arrears for 2 hours, the model services will be suspended. Services will resume once the account has been recharged. Please make sure that all outstanding bills are paid on time to avoid any unexpected service interruption.


<span id="a0b6643a"></span>
# Coding Plan


<span aceTableMode="list" aceTableWidth="1,1,1"></span>
|**Plan** |**Subscription duration** |**Price** |
|---|---|---|
|Lite |1 month |10 USD |
||3 months |30 USD |
|Pro |1 month |50 USD |
||3 months |150 USD |


> For plan information and special offers, see [Subscription overview](https://docs.byteplus.com/en/docs/ModelArk/1925114).





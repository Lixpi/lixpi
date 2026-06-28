ModelArk offers a variety of models. Use the tutorials or API references provided to easily integrate model services into your applications.


<columns>
<columnsItem zoneid="xjsRAHTwAw">


<card mode="container" href="https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-2-0-pro" img="https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_model/banner_thinking.png" >

**Dola Seed 2.0**

**Flagship general\\-purpose agentic model**

Built for complex reasoning and long\\-chain, multi\\-step task execution in the Agent era

</card>



</columnsItem>
<columnsItem zoneid="lWz6X1rCSw">


<card mode="container" href="https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=dreamina-seedance-2-0" img="https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_model/banner_video_generation.png" >

**Dreamina Seedance 2.0**

**Mainline video generation model**

High\\-fidelity audio–visual synchronization, high motion quality and emotional expression

</card>



</columnsItem>
<columnsItem zoneid="OoTf9lPOhV">


<card mode="container" href="https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seedream-5-0" img="https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_model/banner_image_generation.png" >

**Dola Seedream 5.0**

**Leading image generation model**

Enhanced reference consistency and improved generation quality for professional scenarios

</card>



</columnsItem>
</columns>


<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>



* <div data-tips="true" data-tips-type="tip"><strong>Region availability</strong>:</div>


   * <div data-tips="true" data-tips-type="tip">Currently, all the models listed in <a href="https://docs.byteplus.com/en/docs/ModelArk/1330310">Model list</a> are supported in the <code>ap-southeast-1</code> region.</div>


   * <div data-tips="true" data-tips-type="tip">The seed\-2\-0 and seedream\-5\-0\-lite models are also supported in the <code>eu-west-1</code> region.</div>


* <div data-tips="true" data-tips-type="tip">Base URL by region:</div>


   * <div data-tips="true" data-tips-type="tip"><code>ap-southeast-1</code>: <code>https://ark.ap-southeast.bytepluses.com/api/v3</code></div>


   * <div data-tips="true" data-tips-type="tip"><code>eu-west-1</code>: <code>https://ark.eu-west.bytepluses.com/api/v3</code></div>



<div data-tips="true" data-tips-type="tip">For more information, see <a href="https://docs.byteplus.com/en/docs/ModelArk/2191806">Region availability</a>.</div>


<div data-tips="true" data-tips-type="warning" data-tips-is-title="true">warning</div>


<div data-tips="true" data-tips-type="warning">All rate limits listed in this document are theoretical maximum values which are not guaranteed, and will be affected by platform load and invocation method. For details, see <a href="https://docs.byteplus.com/en/docs/ModelArk/1848593">Best practices for handling burst traffic</a>.</div>


<span id="898d064d"></span>
# Deep reasoning

Tutorial: [Deep reasoning](https://docs.byteplus.com/en/docs/ModelArk/1449737) | APIs: [Chat API](https://docs.byteplus.com/en/docs/ModelArk/1494384), [Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request)


<span aceTableMode="list" aceTableWidth="3,3,3,2"></span>
|**Model ID** |**Capabilities** |**Length limits (tokens)**  |**Rate limits** |
|---|---|---|---|
|[seed-2-0-lite-260428](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-2-0-lite) |Deep Reasoning<br><br>Text Generation<br><br>Multi\-modal Understanding<br><br>Function Calling |Context Length: 256K<br><br>Max Input: 256K<br><br>Max Output (incl. CoT): 128K, (Default: 4K)<br><br>Max CoT: 128K |30K Max RPM<br><br>1500K Max TPM |
|[seed-2-0-mini-260428](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-2-0-mini) |Deep Reasoning<br><br>Text Generation<br><br>Multi\-modal Understanding<br><br>Function Calling |Context Length: 256K<br><br>Max Input: 256K<br><br>Max Output (incl. CoT): 128K, (Default: 4K)<br><br>Max CoT: 128K |30K Max RPM<br><br>1500K Max TPM |
|[seed-2-0-pro-260328](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-2-0-pro) |Deep Reasoning<br><br>Text Generation<br><br>Multi\-modal Understanding<br><br>Tool Calling |Context Length: 256K<br><br>Max Input: 256K<br><br>Max Output (incl. CoT): 128K, (Default: 4K)<br><br>Max CoT: 128K |30K Max RPM<br><br>1500K Max TPM |
|[seed-2-0-lite-260228](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-2-0-lite) |Deep Reasoning<br><br>Text Generation<br><br>Multi\-modal Understanding<br><br>Function Calling<br><br>Structured Output |Context Length: 256K<br><br>Max Input: 256K<br><br>Max Output (incl. CoT): 128K, (Default: 4K)<br><br>Max CoT: 128K |30K Max RPM<br><br>1500K Max TPM |
|[seed-2-0-mini-260215](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-2-0-mini) |Deep Reasoning<br><br>Text Generation<br><br>Multi\-modal Understanding<br><br>Function Calling<br><br>Structured Output |Context Length: 256K<br><br>Max Input: 256K<br><br>Max Output (incl. CoT): 128K, (Default: 4K)<br><br>Max CoT: 128K |30K Max RPM<br><br>1500K Max TPM |
|[seed-2-0-code-preview-260328](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-2-0-code) |Deep Reasoning<br><br>Text Generation<br><br>Multi\-modal Understanding<br><br>Function Calling |Context Length: 256K<br><br>Max Input: 256K<br><br>Max Output (incl. CoT): 128K, (Default: 4K)<br><br>Max CoT: 128K |30K Max RPM<br><br>1500K Max TPM |
|[seed-1-8-251228](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-1-8) |Deep Reasoning<br><br>Text Generation<br><br>Multi\-modal Understanding<br><br>Function Calling<br><br>Structured Output |Context Length: 256K<br><br>Max Input: 224K<br><br>Max Output (incl. CoT): 64K, (Default: 4K)<br><br>Max CoT: 32K |30K Max RPM<br><br>1500K Max TPM |
|[glm-4-7-251222](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=glm-4-7) |Deep Reasoning<br><br>Text Generation<br><br>Function Calling |Context Length: 256K<br><br>Max Input: 224K<br><br>Max Output (incl. CoT): 128K, (Default: 4K)<br><br>Max CoT: 128K |15K Max RPM<br><br>1500K Max TPM |
|[deepseek-v4-pro-260425](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=deepseek-v4-pro) |Deep Reasoning<br><br>Text Generation<br><br>Function Calling |Context Length: 1024K<br><br>Max Input: 1024K<br><br>Max Output (incl. CoT): 384K, (Default: 4K)<br><br>Max CoT: 384K |15K Max RPM<br><br>1500K Max TPM |
|[deepseek-v4-flash-260425](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=deepseek-v4-flash) |Deep Reasoning<br><br>Text Generation<br><br>Function Calling |Context Length: 1024K<br><br>Max Input: 1024K<br><br>Max Output (incl. CoT): 384K, (Default: 4K)<br><br>Max CoT: 384K |15K Max RPM<br><br>1500K Max TPM |
|[deepseek-v3-2-251201](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=deepseek-v3-2) |Deep Reasoning<br><br>Text Generation<br><br>Function Calling |Context Length: 128K<br><br>Max Input: 128K<br><br>Max Output (incl. CoT): 32K, (Default: 4K)<br><br>Max CoT: 32K |15K Max RPM<br><br>1500K Max TPM |
|[gpt-oss-120b-250805](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=gpt-oss-120b) |Deep Reasoning<br><br>Text Generation<br><br>Function Calling |Context Length: 128K<br><br>Max Input: 96K<br><br>Max Output (incl. CoT): 64K, (Default: 4K)<br><br>Max CoT: 32K |15K Max RPM<br><br>800K Max TPM |
|[seed-1-6-250915](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-1-6) |Deep Reasoning<br><br>Text Generation<br><br>Image Understanding<br><br>Video Understanding<br><br>Structured Output<br><br>Function Calling |Context Length: 256K<br><br>Max Input: 224K<br><br>Max Output (incl. CoT): 32K, (Default: 4K)<br><br>Max CoT: 32K |15K Max RPM<br><br>800K Max TPM |
|[seed-1-6-250615](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-1-6) |Deep Reasoning<br><br>Text Generation<br><br>Visual Grounding<br><br>Image Understanding<br><br>Video Understanding<br><br>Structured Output<br><br>Function Calling |Context Length: 256K<br><br>Max Input: 224K<br><br>Max Output (incl. CoT): 32K, (Default: 4K)<br><br>Max CoT: 32K |15K Max RPM<br><br>800K Max TPM |
|[seed-1-6-flash-250715](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-1-6-flash) |Deep Reasoning<br><br>Text Generation<br><br>Visual Grounding<br><br>Image Understanding<br><br>Video Understanding<br><br>Structured Output<br><br>Function Calling |Context Length: 256K<br><br>Max Input: 224K<br><br>Max Output (incl. CoT): 32K, (Default: 4K)<br><br>Max CoT: 32K |15K Max RPM<br><br>800K Max TPM |
|[seed-1-6-flash-250615](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-1-6-flash) |Deep Reasoning<br><br>Text Generation<br><br>Image Understanding<br><br>Video Understanding<br><br>Structured Output<br><br>Function Calling |Context Length: 256K<br><br>Max Input: 224K<br><br>Max Output (incl. CoT): 32K, (Default: 4K)<br><br>Max CoT: 32K |15K Max RPM<br><br>800K Max TPM |


<span id="b318deb2"></span>
# Text generation

Tutorial: [Text generation](https://docs.byteplus.com/en/docs/ModelArk/1399009) | API: [Chat API](https://docs.byteplus.com/en/docs/ModelArk/1494384), [Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request)


<span aceTableMode="list" aceTableWidth="3,3,3,2"></span>
|**Model ID** |**Capabilities** |**Length limits (tokens)**  |**Rate limits** |
|---|---|---|---|
|[seed-2-0-lite-260428](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-2-0-lite) |Deep Reasoning<br><br>Text Generation<br><br>Multi\-modal Understanding<br><br>Function Calling |Context Length: 256K<br><br>Max Input: 256K<br><br>Max Output (incl. CoT): 128K, (Default: 4K)<br><br>Max CoT: 128K |30K Max RPM<br><br>1500K Max TPM |
|[seed-2-0-mini-260428](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-2-0-mini) |Deep Reasoning<br><br>Text Generation<br><br>Multi\-modal Understanding<br><br>Function Calling |Context Length: 256K<br><br>Max Input: 256K<br><br>Max Output (incl. CoT): 128K, (Default: 4K)<br><br>Max CoT: 128K |30K Max RPM<br><br>1500K Max TPM |
|[seed-2-0-pro-260328](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-2-0-pro) |Deep Reasoning<br><br>Text Generation<br><br>Multi\-modal Understanding<br><br>Tool Calling |Context Length: 256K<br><br>Max Input: 224K<br><br>Max Output (incl. CoT): 128K, (Default: 4K)<br><br>Max CoT: 128K |30K Max RPM<br><br>1500K Max TPM |
|[seed-2-0-lite-260228](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-2-0-lite) |Deep Reasoning<br><br>Text Generation<br><br>Multi\-modal Understanding<br><br>Function Calling<br><br>Structured Output |Context Length: 256K<br><br>Max Input: 224K<br><br>Max Output (incl. CoT): 128K, (Default: 4K)<br><br>Max CoT: 128K |30K Max RPM<br><br>1500K Max TPM |
|[seed-2-0-mini-260215](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-2-0-mini) |Deep Reasoning<br><br>Text Generation<br><br>Multi\-modal Understanding<br><br>Function Calling<br><br>Structured Output |Context Length: 256K<br><br>Max Input: 224K<br><br>Max Output (incl. CoT): 128K, (Default: 4K)<br><br>Max CoT: 128K |30K Max RPM<br><br>1500K Max TPM |
|[seed-2-0-code-preview-260328](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-2-0-code) |Deep Reasoning<br><br>Text Generation<br><br>Multi\-modal Understanding<br><br>Function Calling |Context Length: 256K<br><br>Max Input: 224K<br><br>Max Output (incl. CoT): 128K, (Default: 4K)<br><br>Max CoT: 128K |30K Max RPM<br><br>1500K Max TPM |
|[seed-1-8-251228](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-1-8) |Deep Reasoning<br><br>Text Generation<br><br>Multi\-modal Understanding<br><br>Function Calling<br><br>Structured Output |Context Length: 256K<br><br>Max Input: 224K<br><br>Max Output (incl. CoT): 64K, (Default: 4K)<br><br>Max CoT: 32K |30K Max RPM<br><br>1500K Max TPM |
|[glm-4-7-251222](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=glm-4-7) |Deep Reasoning<br><br>Text Generation<br><br>Function Calling |Context Length: 256K<br><br>Max Input: 224K<br><br>Max Output (incl. CoT): 128K, (Default: 4K)<br><br>Max CoT: 128K |15K Max RPM<br><br>1500K Max TPM |
|[deepseek-v4-pro-260425](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=deepseek-v4-pro) |Deep Reasoning<br><br>Text Generation<br><br>Function Calling |Context Length: 1024K<br><br>Max Input: 1024K<br><br>Max Output (incl. CoT): 384K, (Default: 4K)<br><br>Max CoT: 384K |15K Max RPM<br><br>1500K Max TPM |
|[deepseek-v4-flash-260425](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=deepseek-v4-flash) |Deep Reasoning<br><br>Text Generation<br><br>Function Calling |Context Length: 1024K<br><br>Max Input: 1024K<br><br>Max Output (incl. CoT): 384K, (Default: 4K)<br><br>Max CoT: 384K |15K Max RPM<br><br>1500K Max TPM |
|[deepseek-v3-2-251201](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=deepseek-v3-2) |Deep Reasoning<br><br>Text Generation<br><br>Function Calling |Context Length: 128K<br><br>Max Input: 128K<br><br>Max Output (incl. CoT): 32K, (Default: 4K)<br><br>Max CoT: 32K |15K Max RPM<br><br>1500K Max TPM |
|[seed-1-6-250915](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-1-6) |Deep Reasoning<br><br>Text Generation<br><br>Image Understanding<br><br>Video Understanding<br><br>Structured Output<br><br>Function Calling |Context Length: 256K<br><br>Max Input: 224K<br><br>Max Output (incl. CoT): 32K, (Default: 4K)<br><br>Max CoT: 32K |15K Max RPM<br><br>800K Max TPM |
|[seed-1-6-250615](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-1-6) |Deep Reasoning<br><br>Text Generation<br><br>Image Understanding<br><br>Video Understanding<br><br>Structured Output<br><br>Function Calling |Context Length: 256K<br><br>Max Input: 224K<br><br>Max Output (incl. CoT): 32K, (Default: 4K)<br><br>Max CoT: 32K |15K Max RPM<br><br>800K Max TPM |
|[seed-1-6-flash-250715](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-1-6-flash) |Deep Reasoning<br><br>Text Generation<br><br>Image Understanding<br><br>Video Understanding<br><br>Structured Output<br><br>Function Calling |Context Length: 256K<br><br>Max Input: 224K<br><br>Max Output (incl. CoT): 32K, (Default: 4K)<br><br>Max CoT: 32K |15K Max RPM<br><br>800K Max TPM |
|[seed-1-6-flash-250615](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-1-6-flash) |Deep Reasoning<br><br>Text Generation<br><br>Image Understanding<br><br>Video Understanding<br><br>Structured Output<br><br>Function Calling |Context Length: 256K<br><br>Max Input: 224K<br><br>Max Output (incl. CoT): 32K, (Default: 4K)<br><br>Max CoT: 32K |15K Max RPM<br><br>800K Max TPM |


<span id="ff5ef604"></span>
# Visual understanding

Tutorials: [Image understanding](https://docs.byteplus.com/en/docs/ModelArk/1362931), [Video understanding](https://docs.byteplus.com/en/docs/ModelArk/1895586) and [Document understanding](https://docs.byteplus.com/en/docs/ModelArk/1902647) | API: [Chat API](https://docs.byteplus.com/en/docs/ModelArk/1494384), [Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request)


<span aceTableMode="list" aceTableWidth="3,3,3,2"></span>
|**Model ID** |**Capabilities** |**Length limits (tokens)**  |**Rate limits** |
|---|---|---|---|
|[seed-2-0-lite-260428](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-2-0-lite) |Deep Reasoning<br><br>Text Generation<br><br>Multi\-modal Understanding<br><br>Function Calling |Context Length: 256K<br><br>Max Input: 256K<br><br>Max Output (incl. CoT): 128K, (Default: 4K)<br><br>Max CoT: 128K |30K Max RPM<br><br>1500K Max TPM |
|[seed-2-0-mini-260428](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-2-0-mini) |Deep Reasoning<br><br>Text Generation<br><br>Multi\-modal Understanding<br><br>Function Calling |Context Length: 256K<br><br>Max Input: 256K<br><br>Max Output (incl. CoT): 128K, (Default: 4K)<br><br>Max CoT: 128K |30K Max RPM<br><br>1500K Max TPM |
|[seed-2-0-pro-260328](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-2-0-pro) |Deep Reasoning<br><br>Text Generation<br><br>Multi\-modal Understanding<br><br>Visual Grounding<br><br>Tool Calling |Context Length: 256K<br><br>Max Input: 256K<br><br>Max Output (incl. CoT): 128K, (Default: 4K)<br><br>Max CoT: 128K |30K Max RPM<br><br>1500K Max TPM |
|[seed-2-0-lite-260228](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-2-0-lite) |Deep Reasoning<br><br>Text Generation<br><br>Multi\-modal Understanding<br><br>Function Calling<br><br>Structured Output |Context Length: 256K<br><br>Max Input: 256K<br><br>Max Output (incl. CoT): 128K, (Default: 4K)<br><br>Max CoT: 128K |30K Max RPM<br><br>1500K Max TPM |
|[seed-2-0-mini-260215](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-2-0-mini) |Deep Reasoning<br><br>Text Generation<br><br>Multi\-modal Understanding<br><br>Visual Grounding<br><br>Function Calling<br><br>Structured Output |Context Length: 256K<br><br>Max Input: 256K<br><br>Max Output (incl. CoT): 128K, (Default: 4K)<br><br>Max CoT: 128K |30K Max RPM<br><br>1500K Max TPM |
|[seed-2-0-code-preview-260328](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-2-0-code) |Deep Reasoning<br><br>Text Generation<br><br>Multi\-modal Understanding<br><br>Function Calling |Context Length: 256K<br><br>Max Input: 256K<br><br>Max Output (incl. CoT): 128K, (Default: 4K)<br><br>Max CoT: 128K |30K Max RPM<br><br>1500K Max TPM |
|[seed-1-8-251228](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-1-8) |Deep Reasoning<br><br>Text Generation<br><br>Multi\-modal Understanding<br><br>Visual Grounding<br><br>Function Calling<br><br>Structured Output |Context Length: 256K<br><br>Max Input: 224K<br><br>Max Output (incl. CoT): 64K, (Default: 4K)<br><br>Max CoT: 32K |30K Max RPM<br><br>1500K Max TPM |
|[seed-1-6-250915](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-1-6) |Deep Reasoning<br><br>Text Generation<br><br>Image Understanding<br><br>Video Understanding<br><br>Structured Output<br><br>Function Calling |Context Length: 256K<br><br>Max Input: 224K<br><br>Max Output (incl. CoT): 32K, (Default: 4K)<br><br>Max CoT: 32K |15K Max RPM<br><br>800K Max TPM |
|[seed-1-6-250615](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-1-6) |Deep Reasoning<br><br>Text Generation<br><br>Image Understanding<br><br>Video Understanding<br><br>Visual Grounding<br><br>Structured Output<br><br>Function Calling |Context Length: 256K<br><br>Max Input: 224K<br><br>Max Output (incl. CoT): 32K, (Default: 4K)<br><br>Max CoT: 32K |15K Max RPM<br><br>800K Max TPM |
|[seed-1-6-flash-250715](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-1-6-flash) |Deep Reasoning<br><br>Text Generation<br><br>Image Understanding<br><br>Video Understanding<br><br>Visual Grounding<br><br>Structured Output<br><br>Function Calling |Context Length: 256K<br><br>Max Input: 224K<br><br>Max Output (incl. CoT): 32K, (Default: 4K)<br><br>Max CoT: 32K |15K Max RPM<br><br>800K Max TPM |
|[seed-1-6-flash-250615](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-1-6-flash) |Deep Reasoning<br><br>Text Generation<br><br>Image Understanding<br><br>Video Understanding<br><br>Visual Grounding<br><br>Structured Output<br><br>Function Calling |Context Length: 256K<br><br>Max Input: 224K<br><br>Max Output (incl. CoT): 32K, (Default: 4K)<br><br>Max CoT: 32K |15K Max RPM<br><br>800K Max TPM |


<span id="71261947"></span>
# Audio understanding

Tutorial: [Audio understanding](https://docs.byteplus.com/en/docs/ModelArk/2377589) | API: [Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request), [Chat API](https://docs.byteplus.com/en/docs/ModelArk/1494384)


<span aceTableMode="list" aceTableWidth="3,3,3,2"></span>
|**Model ID** |**Capabilities** |**Length limits (tokens)**  |**Rate limits** |
|---|---|---|---|
|[seed-2-0-lite-260428](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-2-0-lite) |Deep Reasoning<br><br>Text Generation<br><br>Multi\-modal Understanding<br><br>Function Calling |Context Length: 256K<br><br>Max Input: 256K<br><br>Max Output (incl. CoT): 128K, (Default: 4K)<br><br>Max CoT: 128K |30K Max RPM<br><br>1500K Max TPM |
|[seed-2-0-mini-260428](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-2-0-mini) |Deep Reasoning<br><br>Text Generation<br><br>Multi\-modal Understanding<br><br>Function Calling |Context Length: 256K<br><br>Max Input: 256K<br><br>Max Output (incl. CoT): 128K, (Default: 4K)<br><br>Max CoT: 128K |30K Max RPM<br><br>1500K Max TPM |


<span id="243969e9"></span>
# **Tool use**


<span aceTableMode="list" aceTableWidth="1,1,1"></span>
|**Model ID** |**Function calling**<br><br>[Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request) & [Chat API](https://docs.byteplus.com/en/docs/ModelArk/1494384) |**MCP**<br><br>[Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request) |
|---|---|---|
|[seed-2-0-lite-260428](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-2-0-lite) |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |
|[seed-2-0-mini-260428](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-2-0-mini) |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |
|[seed-2-0-pro-260328](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-2-0-pro) |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |
|[seed-2-0-lite-260215](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-2-0-lite) |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |
|[seed-2-0-mini-260215](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-2-0-mini) |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |
|[seed-2-0-code-preview-260328](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-2-0-code) |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/6767c68a10aa4707b4207ce2474d62b9~tplv-goo7wpa0wc-image.image) </span> |
|[seed-1-8-251228](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-1-8) |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |
|[seed-1-6-250915](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-1-6) |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |
|[seed-1-6-250615](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-1-6) |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |
|[seed-1-6-flash-250715](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-1-6-flash) |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |
|[seed-1-6-flash-250615](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-1-6-flash) |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |
|[glm-4-7-251222](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=glm-4-7) |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |
|[deepseek-v4-pro-260425](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=deepseek-v4-pro) |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |
|[deepseek-v4-flash-260425](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=deepseek-v4-flash) |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |
|[deepseek-v3-2-251201](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=deepseek-v3-2) |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |


Related tutorials:


* [Function calling](https://docs.byteplus.com/en/docs/ModelArk/1262342)

* [Cloud-deployed MCP / remote MCP](https://docs.byteplus.com/en/docs/ModelArk/1827534)


<span id="476e6f25"></span>
# Context caching

Overview: [Context caching overview](https://docs.byteplus.com/en/docs/ModelArk/1398933) | API: [Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request), [Create context caching API](https://docs.byteplus.com/en/docs/ModelArk/1346559)

> Context API is only supported by some legacy models.



<span aceTableMode="list" aceTableWidth="1,1,1"></span>
|**Model ID** |**Implicit cache** |**Explicit cache** |
|---|---|---|
|[seed-2-0-lite-260428](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-2-0-lite) |[Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request)<br><br>[Chat API](https://docs.byteplus.com/en/docs/ModelArk/1494384) |[Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request)<br><br>Prefix Caching<br><br>Session Caching |
|[seed-2-0-mini-260428](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-2-0-mini) |[Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request)<br><br>[Chat API](https://docs.byteplus.com/en/docs/ModelArk/1494384) |[Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request)<br><br>Prefix Caching<br><br>Session Caching |
|[seed-2-0-pro-260328](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-2-0-pro) |[Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request)<br><br>[Chat API](https://docs.byteplus.com/en/docs/ModelArk/1494384) |[Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request)<br><br>Prefix Caching<br><br>Session Caching |
|[seed-2-0-lite-260228](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-2-0-lite) |[Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request)<br><br>[Chat API](https://docs.byteplus.com/en/docs/ModelArk/1494384) |[Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request)<br><br>Prefix Caching<br><br>Session Caching |
|[seed-2-0-mini-260215](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-2-0-mini) |[Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request)<br><br>[Chat API](https://docs.byteplus.com/en/docs/ModelArk/1494384) |[Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request)<br><br>Prefix Caching<br><br>Session Caching |
|[seed-2-0-code-preview-260328](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-2-0-code) |[Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request)<br><br>[Chat API](https://docs.byteplus.com/en/docs/ModelArk/1494384) |[Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request)<br><br>Prefix Caching<br><br>Session Caching |
|[seed-1-8-251228](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-1-8) |[Batch API (Chat)](https://docs.byteplus.com/en/docs/ModelArk/1528783)<br><br>[Batch Inference API (Job)](https://docs.byteplus.com/en/docs/ModelArk/Manage_Batch_Inference_Tasks) |[Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request)<br><br>Prefix Caching<br><br>Session Caching |
|[glm-4-7-251222](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=glm-4-7) |[Batch API (Chat)](https://docs.byteplus.com/en/docs/ModelArk/1528783)<br><br>[Batch Inference API (Job)](https://docs.byteplus.com/en/docs/ModelArk/Manage_Batch_Inference_Tasks) |[Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request)<br><br>Prefix Caching<br><br>Session Caching |
|[deepseek-v4-pro-260425](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=deepseek-v4-pro) |[Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request)<br><br>[Chat API](https://docs.byteplus.com/en/docs/ModelArk/1494384) |[Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request)<br><br>Prefix Caching<br><br>Session Caching |
|[deepseek-v4-flash-260425](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=deepseek-v4-flash) |[Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request)<br><br>[Chat API](https://docs.byteplus.com/en/docs/ModelArk/1494384) |[Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request)<br><br>Prefix Caching<br><br>Session Caching |
|[deepseek-v3-2-251201](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=deepseek-v3-2) |[Batch API (Chat)](https://docs.byteplus.com/en/docs/ModelArk/1528783)<br><br>[Batch Inference API (Job)](https://docs.byteplus.com/en/docs/ModelArk/Manage_Batch_Inference_Tasks) |[Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request)<br><br>Prefix Caching<br><br>Session Caching |
|[seed-1-6-250915](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-1-6) |[Batch API (Chat)](https://docs.byteplus.com/en/docs/ModelArk/1528783)<br><br>[Batch Inference API (Job)](https://docs.byteplus.com/en/docs/ModelArk/Manage_Batch_Inference_Tasks) |[Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request)<br><br>Prefix Caching<br><br>Session Caching |
|[seed-1-6-250615](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-1-6) |[Batch API (Chat)](https://docs.byteplus.com/en/docs/ModelArk/1528783)<br><br>[Batch Inference API (Job)](https://docs.byteplus.com/en/docs/ModelArk/Manage_Batch_Inference_Tasks) |[Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request)<br><br>Prefix Caching<br><br>Session Caching |
|[seed-1-6-flash-250715](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-1-6-flash) |[Batch API (Chat)](https://docs.byteplus.com/en/docs/ModelArk/1528783)<br><br>[Batch Inference API (Job)](https://docs.byteplus.com/en/docs/ModelArk/Manage_Batch_Inference_Tasks) |[Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request)<br><br>Prefix Caching<br><br>Session Caching |
|[seed-1-6-flash-250615](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-1-6-flash) |[Batch API (Chat)](https://docs.byteplus.com/en/docs/ModelArk/1528783)<br><br>[Batch Inference API (Job)](https://docs.byteplus.com/en/docs/ModelArk/Manage_Batch_Inference_Tasks) |[Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request)<br><br>Prefix Caching<br><br>Session Caching |


<span id="25b394c2"></span>
# Structured output (beta)

Overview: [Structured output (beta)](https://docs.byteplus.com/en/docs/ModelArk/1568221) | API: [Chat API](https://docs.byteplus.com/en/docs/ModelArk/1494384), [Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request)

<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>


<div data-tips="true" data-tips-type="tip">This capability is still in the beta phase. Proceed with caution when using it in the production environment.</div>



<span aceTableMode="list" aceTableWidth="3,3,3,2"></span>
|**Model ID** |**Capabilities** |**Length limits (tokens)**  |**Rate limits** |
|---|---|---|---|
|[seed-2-0-lite-260228](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-2-0-lite) |Deep Reasoning<br><br>Text Generation<br><br>Multi\-modal Understanding<br><br>Function Calling<br><br>Structured Output |Context Length: 256K<br><br>Max Input: 256K<br><br>Max Output (incl. CoT): 128K, (Default: 4K)<br><br>Max CoT: 128K |30K Max RPM<br><br>1500K Max TPM |
|[seed-2-0-mini-260215](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-2-0-mini) |Deep Reasoning<br><br>Text Generation<br><br>Multi\-modal Understanding<br><br>Function Calling<br><br>Structured Output |Context Length: 256K<br><br>Max Input: 256K<br><br>Max Output (incl. CoT): 128K, (Default: 4K)<br><br>Max CoT: 128K |30K Max RPM<br><br>1500K Max TPM |
|[seed-1-8-251228](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-1-8) |Deep Reasoning<br><br>Text Generation<br><br>Multi\-modal Understanding<br><br>Function Calling<br><br>Structured Output |Context Length: 256K<br><br>Max Input: 224K<br><br>Max Output (incl. CoT): 64K, (Default: 4K)<br><br>Max CoT: 32K |30K Max RPM<br><br>1500K Max TPM |
|[deepseek-v3-2-251201](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=deepseek-v3-2) |Deep Reasoning<br><br>Text Generation<br><br>Function Calling |Context Length: 128K<br><br>Max Input: 128K<br><br>Max Output (incl. CoT): 32K, (Default: 4K)<br><br>Max CoT: 32K |15K Max RPM<br><br>1500K Max TPM |
|[seed-1-6-250915](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-1-6) |Deep Reasoning<br><br>Text Generation<br><br>Image Understanding<br><br>Video Understanding<br><br>Structured Output<br><br>Function Calling |Context Length: 256K<br><br>Max Input: 224K<br><br>Max Output (incl. CoT): 32K, (Default: 4K)<br><br>Max CoT: 32K |15K Max RPM<br><br>800K Max TPM |
|[seed-1-6-250615](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-1-6) |Deep Reasoning<br><br>Text Generation<br><br>Image Understanding<br><br>Video Understanding<br><br>Structured Output<br><br>Function Calling |Context Length: 256K<br><br>Max Input: 224K<br><br>Max Output (incl. CoT): 32K, (Default: 4K)<br><br>Max CoT: 32K |15K Max RPM<br><br>800K Max TPM |
|[seed-1-6-flash-250715](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-1-6-flash) |Deep Reasoning<br><br>Text Generation<br><br>Visual Grounding<br><br>Image Understanding<br><br>Video Understanding<br><br>Structured Output<br><br>Function Calling |Context Length: 256K<br><br>Max Input: 224K<br><br>Max Output (incl. CoT): 32K, (Default: 4K)<br><br>Max CoT: 32K |15K Max RPM<br><br>800K Max TPM |
|[seed-1-6-flash-250615](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-1-6-flash) |Deep Reasoning<br><br>Text Generation<br><br>Visual Grounding<br><br>Image Understanding<br><br>Video Understanding<br><br>Structured Output<br><br>Function Calling |Context Length: 256K<br><br>Max Input: 224K<br><br>Max Output (incl. CoT): 32K, (Default: 4K)<br><br>Max CoT: 32K |15K Max RPM<br><br>800K Max TPM |


<span id="2705b333"></span>
# Video generation

Tutorials: [Video generation](https://docs.byteplus.com/en/docs/ModelArk/2300461) | API: [Video Generation API](https://docs.byteplus.com/en/docs/ModelArk/Video_Generation_API)


<span aceTableMode="list" aceTableWidth="2,3,3,3"></span>
|**Model ID** |**Capabilities** |**Output video format** |**Rate limits**:<br><br>> default (Online Inference)<br><br>> flex (Offline Inference) |
|---|---|---|---|
|[dreamina-seedance-2-0-260128](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=dreamina-seedance-2-0) `audio-visual sync` |Multimodal Reference to Video<br><br>Video Modification<br><br>Video Extension<br><br>Image\-to\-Video \- First and Last Frames<br><br>Image\-to\-Video \- First Frame<br><br>Text\-to\-Video |Resolution:<br><br>480p, 720p, 1080p, 4k (10bit\-encoding)<br><br>Frame Rate: 24 fps<br><br>Duration: 4–15 s<br><br>Video Format: .mp4 |**Non\-4k**<br><br><br>* default (enterprise users):<br><br>   * Max RPM: 600<br><br>   * Max concurrency: 10<br><br>* default (individual users):<br><br>   * Max RPM: 180<br><br>   * Max concurrency: 3<br><br>      **4k**<br><br>* default (enterprise users):<br><br>   * Max RPM: 15<br><br>   * Max concurrency: 1<br><br>* default (individual users):<br><br>   * Max RPM: 15<br><br>   * Max concurrency: 1 |
|[dreamina-seedance-2-0-fast-260128](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=dreamina-seedance-2-0-fast) `audio-visual sync` |Multimodal Reference to Video<br><br>Video Modification<br><br>Video Extension<br><br>Image\-to\-Video \- First and Last Frames<br><br>Image\-to\-Video \- First Frame<br><br>Text\-to\-Video |Resolution:<br><br>480p, 720p<br><br>Frame Rate: 24 fps<br><br>Duration: 4–15 s<br><br>Video Format: .mp4 |* default (enterprise users):<br><br>   * Max RPM: 600<br><br>   * Max concurrency: 10<br><br>* default (individual users):<br><br>   * Max RPM: 180<br><br>   * Max concurrency: 3<br><br>* flex: Not supported |
|[dreamina-seedance-2-0-mini-260615](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=dreamina-seedance-2-0-mini) `audio-visual sync` |Multimodal Reference to Video<br><br>Video Modification<br><br>Video Extension<br><br>Image\-to\-Video \- First and Last Frames<br><br>Image\-to\-Video \- First Frame<br><br>Text\-to\-Video |Resolution:<br><br>480p, 720p<br><br>Frame Rate: 24 fps<br><br>Duration: 4–15 s<br><br>Video Format: .mp4 |* default (enterprise users):<br><br>   * Max RPM: 600<br><br>   * Max concurrency: 10<br><br>* default (individual users):<br><br>   * Max RPM: 180<br><br>   * Max concurrency: 3<br><br>* flex: Not supported |
|[seedance-1-5-pro-251215](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seedance-1-5-pro) `audio-visual sync` |Image\-to\-Video \- First and Last Frames<br><br>Image\-to\-Video \- First Frame<br><br>Text\-to\-Video |Resolution:<br><br>480p, 720p,<br><br>1080p<br><br>Frame Rate: 24 fps<br><br>Duration: 4–12 s<br><br>Video Format: .mp4 |* default:<br><br>   * Max RPM 600<br><br>   * Max concurrency: 10<br><br>* flex:<br><br>   * TPD: 500B |
|[seedance-1-0-pro-250528](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seedance-1-0-pro) |Image\-to\-Video \- First and Last Frames<br><br>Image\-to\-Video \- First Frame<br><br>Text\-to\-Video |Resolution:<br><br>480p,<br><br>720p,<br><br>1080p`Reference image feature is not supported`<br><br>Frame Rate: 24 fps<br><br>Duration: 2–12 s<br><br>Video Format: .mp4 |* default:<br><br>   * Max RPM 600<br><br>   * Max concurrency: 10<br><br>* flex:<br><br>   * TPD: 500B |
|[seedance-1-0-pro-fast-251015](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seedance-1-0-pro-fast) |Image\-to\-Video \- First Frame<br><br>Text\-to\-Video ||* default:<br><br>   * Max RPM 600<br><br>   * Max concurrency: 10<br><br>* flex:<br><br>   * TPD: 500B |


<span id="d3e5e0eb"></span>
# Image generation

Tutorial: [Image generation](https://docs.byteplus.com/en/docs/ModelArk/1824690) | API: [Image generation API](https://docs.byteplus.com/en/docs/ModelArk/1541523)


<span aceTableMode="list" aceTableWidth="1,2,1"></span>
|**Model ID** |**Capabilities** |**Rate limits (Max IPM)**  |
|---|---|---|
|[seedream-5-0-260128](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seedream-5-0)<br><br>(also supports: seedream\-5\-0\-lite\-260128) |Text\-to\-Image<br><br>Image\-to\-Image<br><br><br>* Single Image\-to\-Image<br><br>* Generate images with multiple reference imagesGenerate a batch of images<br><br>* Generate a batch of images from text<br><br>* Generate a batch of images from a single image<br><br>* Generate a batch of images from multiple reference images |500 |
|[seedream-4-5-251128](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seedream-4-5) ||500 |
|[seedream-4-0-250828](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seedream-4-0) ||500 |


<span id="235202b8"></span>
# 3D generation


<span aceTableMode="list" aceTableWidth="1,1,2,1,1"></span>
|**Model ID** |**Capabilities** |**Output video format** |**Rate limits** |**Free quota** |
|---|---|---|---|---|
|[Hyper3d-Rodin-Gen2](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=hyper3d-gen2) |Text to 3D、Images to 3D<br><br><br>* White model<br><br>* Textured model<br><br>* PBR material model<br><br>* Textured model with PBR materials |Polygon count:<br><br><br>* Triangular mesh: [500, 1,000,000]<br><br>* Quad mesh: [1,000, 200,000]File format:<br><br>* glb, obj, stl, fbx, usdz |Max RPM: 60<br><br>Max concurrency: 3 |150K |
|[Hitem3d-2.0](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=hitem3d-2-0) |Images to 3D<br><br><br>* Standard White Model<br><br>* Standard Textured Model<br><br>* High\-Precision White Model<br><br>* High\-Precision Textured Model |Polygon count:<br><br><br>* [100,000, 2,000,000]File format:<br><br>* glb, obj, stl, fbx, usdzResolution:<br><br>* 1536, 1536pro |Max RPM: 600<br><br>Max concurrency: 30 |500K |


<span id="5fa3ded4"></span>
# Multimodal embedding

Tutorial: [Multimodal embedding](https://docs.byteplus.com/en/docs/ModelArk/1409291) | API: [Embeddings Multimodal API](https://docs.byteplus.com/en/docs/ModelArk/1523520)


<span aceTableMode="list" aceTableWidth="1,2,1,1,1"></span>
|**Model ID** |**Capabilities** |**Context length (tokens)**  |**Maximum vector dimension** |**Rate limits** |
|---|---|---|---|---|
|[skylark-embedding-vision-251215](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=skylark-embedding-vision) |Videos, Images and Text vectorization, support Chinese and English |128K |2048 |1.2K Max RPM<br><br>1200K Max TPM |
|[skylark-embedding-vision-250615](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=skylark-embedding-vision) |Videos, Images and Text vectorization, support Chinese and English |128K |2048 |1.2K Max RPM<br><br>1200K Max TPM |




ModelArk offers a variety of models. Use the tutorials or API references provided to easily integrate model services into your applications.


<columns>
<columnsItem zoneid="xjsRAHTwAw">


<card mode="container" href="https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-2-0-pro" img="https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_model/banner_thinking.png" >

**Dola Seed 2.0**

**Flagship general\\-purpose agentic model**

Built for complex reasoning and long\\-chain, multi\\-step task execution in the Agent era

</card>



</columnsItem>
<columnsItem zoneid="lWz6X1rCSw">


<card mode="container" href="https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=dreamina-seedance-2-0" img="https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_model/banner_video_generation.png" >

**Dreamina Seedance 2.0**

**Mainline video generation model**

High\\-fidelity audio–visual synchronization, high motion quality and emotional expression

</card>



</columnsItem>
<columnsItem zoneid="OoTf9lPOhV">


<card mode="container" href="https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seedream-5-0" img="https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_model/banner_image_generation.png" >

**Dola Seedream 5.0**

**Leading image generation model**

Enhanced reference consistency and improved generation quality for professional scenarios

</card>



</columnsItem>
</columns>


<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>



* <div data-tips="true" data-tips-type="tip"><strong>Region availability</strong>:</div>


   * <div data-tips="true" data-tips-type="tip">Currently, all the models listed in <a href="https://docs.byteplus.com/en/docs/ModelArk/1330310">Model list</a> are supported in the <code>ap-southeast-1</code> region.</div>


   * <div data-tips="true" data-tips-type="tip">The seed\-2\-0 and seedream\-5\-0\-lite models are also supported in the <code>eu-west-1</code> region.</div>


* <div data-tips="true" data-tips-type="tip">Base URL by region:</div>


   * <div data-tips="true" data-tips-type="tip"><code>ap-southeast-1</code>: <code>https://ark.ap-southeast.bytepluses.com/api/v3</code></div>


   * <div data-tips="true" data-tips-type="tip"><code>eu-west-1</code>: <code>https://ark.eu-west.bytepluses.com/api/v3</code></div>



<div data-tips="true" data-tips-type="tip">For more information, see <a href="https://docs.byteplus.com/en/docs/ModelArk/2191806">Region availability</a>.</div>


<div data-tips="true" data-tips-type="warning" data-tips-is-title="true">warning</div>


<div data-tips="true" data-tips-type="warning">All rate limits listed in this document are theoretical maximum values which are not guaranteed, and will be affected by platform load and invocation method. For details, see <a href="https://docs.byteplus.com/en/docs/ModelArk/1848593">Best practices for handling burst traffic</a>.</div>


<span id="898d064d"></span>
# Deep reasoning

Tutorial: [Deep reasoning](https://docs.byteplus.com/en/docs/ModelArk/1449737) | APIs: [Chat API](https://docs.byteplus.com/en/docs/ModelArk/1494384), [Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request)


<span aceTableMode="list" aceTableWidth="3,3,3,2"></span>
|**Model ID** |**Capabilities** |**Length limits (tokens)**  |**Rate limits** |
|---|---|---|---|
|[seed-2-0-lite-260428](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-2-0-lite) |Deep Reasoning<br><br>Text Generation<br><br>Multi\-modal Understanding<br><br>Function Calling |Context Length: 256K<br><br>Max Input: 256K<br><br>Max Output (incl. CoT): 128K, (Default: 4K)<br><br>Max CoT: 128K |30K Max RPM<br><br>1500K Max TPM |
|[seed-2-0-mini-260428](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-2-0-mini) |Deep Reasoning<br><br>Text Generation<br><br>Multi\-modal Understanding<br><br>Function Calling |Context Length: 256K<br><br>Max Input: 256K<br><br>Max Output (incl. CoT): 128K, (Default: 4K)<br><br>Max CoT: 128K |30K Max RPM<br><br>1500K Max TPM |
|[seed-2-0-pro-260328](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-2-0-pro) |Deep Reasoning<br><br>Text Generation<br><br>Multi\-modal Understanding<br><br>Tool Calling |Context Length: 256K<br><br>Max Input: 256K<br><br>Max Output (incl. CoT): 128K, (Default: 4K)<br><br>Max CoT: 128K |30K Max RPM<br><br>1500K Max TPM |
|[seed-2-0-lite-260228](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-2-0-lite) |Deep Reasoning<br><br>Text Generation<br><br>Multi\-modal Understanding<br><br>Function Calling<br><br>Structured Output |Context Length: 256K<br><br>Max Input: 256K<br><br>Max Output (incl. CoT): 128K, (Default: 4K)<br><br>Max CoT: 128K |30K Max RPM<br><br>1500K Max TPM |
|[seed-2-0-mini-260215](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-2-0-mini) |Deep Reasoning<br><br>Text Generation<br><br>Multi\-modal Understanding<br><br>Function Calling<br><br>Structured Output |Context Length: 256K<br><br>Max Input: 256K<br><br>Max Output (incl. CoT): 128K, (Default: 4K)<br><br>Max CoT: 128K |30K Max RPM<br><br>1500K Max TPM |
|[seed-2-0-code-preview-260328](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-2-0-code) |Deep Reasoning<br><br>Text Generation<br><br>Multi\-modal Understanding<br><br>Function Calling |Context Length: 256K<br><br>Max Input: 256K<br><br>Max Output (incl. CoT): 128K, (Default: 4K)<br><br>Max CoT: 128K |30K Max RPM<br><br>1500K Max TPM |
|[seed-1-8-251228](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-1-8) |Deep Reasoning<br><br>Text Generation<br><br>Multi\-modal Understanding<br><br>Function Calling<br><br>Structured Output |Context Length: 256K<br><br>Max Input: 224K<br><br>Max Output (incl. CoT): 64K, (Default: 4K)<br><br>Max CoT: 32K |30K Max RPM<br><br>1500K Max TPM |
|[glm-4-7-251222](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=glm-4-7) |Deep Reasoning<br><br>Text Generation<br><br>Function Calling |Context Length: 256K<br><br>Max Input: 224K<br><br>Max Output (incl. CoT): 128K, (Default: 4K)<br><br>Max CoT: 128K |15K Max RPM<br><br>1500K Max TPM |
|[deepseek-v4-pro-260425](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=deepseek-v4-pro) |Deep Reasoning<br><br>Text Generation<br><br>Function Calling |Context Length: 1024K<br><br>Max Input: 1024K<br><br>Max Output (incl. CoT): 384K, (Default: 4K)<br><br>Max CoT: 384K |15K Max RPM<br><br>1500K Max TPM |
|[deepseek-v4-flash-260425](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=deepseek-v4-flash) |Deep Reasoning<br><br>Text Generation<br><br>Function Calling |Context Length: 1024K<br><br>Max Input: 1024K<br><br>Max Output (incl. CoT): 384K, (Default: 4K)<br><br>Max CoT: 384K |15K Max RPM<br><br>1500K Max TPM |
|[deepseek-v3-2-251201](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=deepseek-v3-2) |Deep Reasoning<br><br>Text Generation<br><br>Function Calling |Context Length: 128K<br><br>Max Input: 128K<br><br>Max Output (incl. CoT): 32K, (Default: 4K)<br><br>Max CoT: 32K |15K Max RPM<br><br>1500K Max TPM |
|[gpt-oss-120b-250805](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=gpt-oss-120b) |Deep Reasoning<br><br>Text Generation<br><br>Function Calling |Context Length: 128K<br><br>Max Input: 96K<br><br>Max Output (incl. CoT): 64K, (Default: 4K)<br><br>Max CoT: 32K |15K Max RPM<br><br>800K Max TPM |
|[seed-1-6-250915](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-1-6) |Deep Reasoning<br><br>Text Generation<br><br>Image Understanding<br><br>Video Understanding<br><br>Structured Output<br><br>Function Calling |Context Length: 256K<br><br>Max Input: 224K<br><br>Max Output (incl. CoT): 32K, (Default: 4K)<br><br>Max CoT: 32K |15K Max RPM<br><br>800K Max TPM |
|[seed-1-6-250615](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-1-6) |Deep Reasoning<br><br>Text Generation<br><br>Visual Grounding<br><br>Image Understanding<br><br>Video Understanding<br><br>Structured Output<br><br>Function Calling |Context Length: 256K<br><br>Max Input: 224K<br><br>Max Output (incl. CoT): 32K, (Default: 4K)<br><br>Max CoT: 32K |15K Max RPM<br><br>800K Max TPM |
|[seed-1-6-flash-250715](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-1-6-flash) |Deep Reasoning<br><br>Text Generation<br><br>Visual Grounding<br><br>Image Understanding<br><br>Video Understanding<br><br>Structured Output<br><br>Function Calling |Context Length: 256K<br><br>Max Input: 224K<br><br>Max Output (incl. CoT): 32K, (Default: 4K)<br><br>Max CoT: 32K |15K Max RPM<br><br>800K Max TPM |
|[seed-1-6-flash-250615](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-1-6-flash) |Deep Reasoning<br><br>Text Generation<br><br>Image Understanding<br><br>Video Understanding<br><br>Structured Output<br><br>Function Calling |Context Length: 256K<br><br>Max Input: 224K<br><br>Max Output (incl. CoT): 32K, (Default: 4K)<br><br>Max CoT: 32K |15K Max RPM<br><br>800K Max TPM |


<span id="b318deb2"></span>
# Text generation

Tutorial: [Text generation](https://docs.byteplus.com/en/docs/ModelArk/1399009) | API: [Chat API](https://docs.byteplus.com/en/docs/ModelArk/1494384), [Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request)


<span aceTableMode="list" aceTableWidth="3,3,3,2"></span>
|**Model ID** |**Capabilities** |**Length limits (tokens)**  |**Rate limits** |
|---|---|---|---|
|[seed-2-0-lite-260428](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-2-0-lite) |Deep Reasoning<br><br>Text Generation<br><br>Multi\-modal Understanding<br><br>Function Calling |Context Length: 256K<br><br>Max Input: 256K<br><br>Max Output (incl. CoT): 128K, (Default: 4K)<br><br>Max CoT: 128K |30K Max RPM<br><br>1500K Max TPM |
|[seed-2-0-mini-260428](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-2-0-mini) |Deep Reasoning<br><br>Text Generation<br><br>Multi\-modal Understanding<br><br>Function Calling |Context Length: 256K<br><br>Max Input: 256K<br><br>Max Output (incl. CoT): 128K, (Default: 4K)<br><br>Max CoT: 128K |30K Max RPM<br><br>1500K Max TPM |
|[seed-2-0-pro-260328](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-2-0-pro) |Deep Reasoning<br><br>Text Generation<br><br>Multi\-modal Understanding<br><br>Tool Calling |Context Length: 256K<br><br>Max Input: 224K<br><br>Max Output (incl. CoT): 128K, (Default: 4K)<br><br>Max CoT: 128K |30K Max RPM<br><br>1500K Max TPM |
|[seed-2-0-lite-260228](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-2-0-lite) |Deep Reasoning<br><br>Text Generation<br><br>Multi\-modal Understanding<br><br>Function Calling<br><br>Structured Output |Context Length: 256K<br><br>Max Input: 224K<br><br>Max Output (incl. CoT): 128K, (Default: 4K)<br><br>Max CoT: 128K |30K Max RPM<br><br>1500K Max TPM |
|[seed-2-0-mini-260215](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-2-0-mini) |Deep Reasoning<br><br>Text Generation<br><br>Multi\-modal Understanding<br><br>Function Calling<br><br>Structured Output |Context Length: 256K<br><br>Max Input: 224K<br><br>Max Output (incl. CoT): 128K, (Default: 4K)<br><br>Max CoT: 128K |30K Max RPM<br><br>1500K Max TPM |
|[seed-2-0-code-preview-260328](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-2-0-code) |Deep Reasoning<br><br>Text Generation<br><br>Multi\-modal Understanding<br><br>Function Calling |Context Length: 256K<br><br>Max Input: 224K<br><br>Max Output (incl. CoT): 128K, (Default: 4K)<br><br>Max CoT: 128K |30K Max RPM<br><br>1500K Max TPM |
|[seed-1-8-251228](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-1-8) |Deep Reasoning<br><br>Text Generation<br><br>Multi\-modal Understanding<br><br>Function Calling<br><br>Structured Output |Context Length: 256K<br><br>Max Input: 224K<br><br>Max Output (incl. CoT): 64K, (Default: 4K)<br><br>Max CoT: 32K |30K Max RPM<br><br>1500K Max TPM |
|[glm-4-7-251222](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=glm-4-7) |Deep Reasoning<br><br>Text Generation<br><br>Function Calling |Context Length: 256K<br><br>Max Input: 224K<br><br>Max Output (incl. CoT): 128K, (Default: 4K)<br><br>Max CoT: 128K |15K Max RPM<br><br>1500K Max TPM |
|[deepseek-v4-pro-260425](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=deepseek-v4-pro) |Deep Reasoning<br><br>Text Generation<br><br>Function Calling |Context Length: 1024K<br><br>Max Input: 1024K<br><br>Max Output (incl. CoT): 384K, (Default: 4K)<br><br>Max CoT: 384K |15K Max RPM<br><br>1500K Max TPM |
|[deepseek-v4-flash-260425](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=deepseek-v4-flash) |Deep Reasoning<br><br>Text Generation<br><br>Function Calling |Context Length: 1024K<br><br>Max Input: 1024K<br><br>Max Output (incl. CoT): 384K, (Default: 4K)<br><br>Max CoT: 384K |15K Max RPM<br><br>1500K Max TPM |
|[deepseek-v3-2-251201](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=deepseek-v3-2) |Deep Reasoning<br><br>Text Generation<br><br>Function Calling |Context Length: 128K<br><br>Max Input: 128K<br><br>Max Output (incl. CoT): 32K, (Default: 4K)<br><br>Max CoT: 32K |15K Max RPM<br><br>1500K Max TPM |
|[seed-1-6-250915](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-1-6) |Deep Reasoning<br><br>Text Generation<br><br>Image Understanding<br><br>Video Understanding<br><br>Structured Output<br><br>Function Calling |Context Length: 256K<br><br>Max Input: 224K<br><br>Max Output (incl. CoT): 32K, (Default: 4K)<br><br>Max CoT: 32K |15K Max RPM<br><br>800K Max TPM |
|[seed-1-6-250615](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-1-6) |Deep Reasoning<br><br>Text Generation<br><br>Image Understanding<br><br>Video Understanding<br><br>Structured Output<br><br>Function Calling |Context Length: 256K<br><br>Max Input: 224K<br><br>Max Output (incl. CoT): 32K, (Default: 4K)<br><br>Max CoT: 32K |15K Max RPM<br><br>800K Max TPM |
|[seed-1-6-flash-250715](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-1-6-flash) |Deep Reasoning<br><br>Text Generation<br><br>Image Understanding<br><br>Video Understanding<br><br>Structured Output<br><br>Function Calling |Context Length: 256K<br><br>Max Input: 224K<br><br>Max Output (incl. CoT): 32K, (Default: 4K)<br><br>Max CoT: 32K |15K Max RPM<br><br>800K Max TPM |
|[seed-1-6-flash-250615](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-1-6-flash) |Deep Reasoning<br><br>Text Generation<br><br>Image Understanding<br><br>Video Understanding<br><br>Structured Output<br><br>Function Calling |Context Length: 256K<br><br>Max Input: 224K<br><br>Max Output (incl. CoT): 32K, (Default: 4K)<br><br>Max CoT: 32K |15K Max RPM<br><br>800K Max TPM |


<span id="ff5ef604"></span>
# Visual understanding

Tutorials: [Image understanding](https://docs.byteplus.com/en/docs/ModelArk/1362931), [Video understanding](https://docs.byteplus.com/en/docs/ModelArk/1895586) and [Document understanding](https://docs.byteplus.com/en/docs/ModelArk/1902647) | API: [Chat API](https://docs.byteplus.com/en/docs/ModelArk/1494384), [Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request)


<span aceTableMode="list" aceTableWidth="3,3,3,2"></span>
|**Model ID** |**Capabilities** |**Length limits (tokens)**  |**Rate limits** |
|---|---|---|---|
|[seed-2-0-lite-260428](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-2-0-lite) |Deep Reasoning<br><br>Text Generation<br><br>Multi\-modal Understanding<br><br>Function Calling |Context Length: 256K<br><br>Max Input: 256K<br><br>Max Output (incl. CoT): 128K, (Default: 4K)<br><br>Max CoT: 128K |30K Max RPM<br><br>1500K Max TPM |
|[seed-2-0-mini-260428](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-2-0-mini) |Deep Reasoning<br><br>Text Generation<br><br>Multi\-modal Understanding<br><br>Function Calling |Context Length: 256K<br><br>Max Input: 256K<br><br>Max Output (incl. CoT): 128K, (Default: 4K)<br><br>Max CoT: 128K |30K Max RPM<br><br>1500K Max TPM |
|[seed-2-0-pro-260328](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-2-0-pro) |Deep Reasoning<br><br>Text Generation<br><br>Multi\-modal Understanding<br><br>Visual Grounding<br><br>Tool Calling |Context Length: 256K<br><br>Max Input: 256K<br><br>Max Output (incl. CoT): 128K, (Default: 4K)<br><br>Max CoT: 128K |30K Max RPM<br><br>1500K Max TPM |
|[seed-2-0-lite-260228](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-2-0-lite) |Deep Reasoning<br><br>Text Generation<br><br>Multi\-modal Understanding<br><br>Function Calling<br><br>Structured Output |Context Length: 256K<br><br>Max Input: 256K<br><br>Max Output (incl. CoT): 128K, (Default: 4K)<br><br>Max CoT: 128K |30K Max RPM<br><br>1500K Max TPM |
|[seed-2-0-mini-260215](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-2-0-mini) |Deep Reasoning<br><br>Text Generation<br><br>Multi\-modal Understanding<br><br>Visual Grounding<br><br>Function Calling<br><br>Structured Output |Context Length: 256K<br><br>Max Input: 256K<br><br>Max Output (incl. CoT): 128K, (Default: 4K)<br><br>Max CoT: 128K |30K Max RPM<br><br>1500K Max TPM |
|[seed-2-0-code-preview-260328](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-2-0-code) |Deep Reasoning<br><br>Text Generation<br><br>Multi\-modal Understanding<br><br>Function Calling |Context Length: 256K<br><br>Max Input: 256K<br><br>Max Output (incl. CoT): 128K, (Default: 4K)<br><br>Max CoT: 128K |30K Max RPM<br><br>1500K Max TPM |
|[seed-1-8-251228](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-1-8) |Deep Reasoning<br><br>Text Generation<br><br>Multi\-modal Understanding<br><br>Visual Grounding<br><br>Function Calling<br><br>Structured Output |Context Length: 256K<br><br>Max Input: 224K<br><br>Max Output (incl. CoT): 64K, (Default: 4K)<br><br>Max CoT: 32K |30K Max RPM<br><br>1500K Max TPM |
|[seed-1-6-250915](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-1-6) |Deep Reasoning<br><br>Text Generation<br><br>Image Understanding<br><br>Video Understanding<br><br>Structured Output<br><br>Function Calling |Context Length: 256K<br><br>Max Input: 224K<br><br>Max Output (incl. CoT): 32K, (Default: 4K)<br><br>Max CoT: 32K |15K Max RPM<br><br>800K Max TPM |
|[seed-1-6-250615](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-1-6) |Deep Reasoning<br><br>Text Generation<br><br>Image Understanding<br><br>Video Understanding<br><br>Visual Grounding<br><br>Structured Output<br><br>Function Calling |Context Length: 256K<br><br>Max Input: 224K<br><br>Max Output (incl. CoT): 32K, (Default: 4K)<br><br>Max CoT: 32K |15K Max RPM<br><br>800K Max TPM |
|[seed-1-6-flash-250715](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-1-6-flash) |Deep Reasoning<br><br>Text Generation<br><br>Image Understanding<br><br>Video Understanding<br><br>Visual Grounding<br><br>Structured Output<br><br>Function Calling |Context Length: 256K<br><br>Max Input: 224K<br><br>Max Output (incl. CoT): 32K, (Default: 4K)<br><br>Max CoT: 32K |15K Max RPM<br><br>800K Max TPM |
|[seed-1-6-flash-250615](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-1-6-flash) |Deep Reasoning<br><br>Text Generation<br><br>Image Understanding<br><br>Video Understanding<br><br>Visual Grounding<br><br>Structured Output<br><br>Function Calling |Context Length: 256K<br><br>Max Input: 224K<br><br>Max Output (incl. CoT): 32K, (Default: 4K)<br><br>Max CoT: 32K |15K Max RPM<br><br>800K Max TPM |


<span id="71261947"></span>
# Audio understanding

Tutorial: [Audio understanding](https://docs.byteplus.com/en/docs/ModelArk/2377589) | API: [Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request), [Chat API](https://docs.byteplus.com/en/docs/ModelArk/1494384)


<span aceTableMode="list" aceTableWidth="3,3,3,2"></span>
|**Model ID** |**Capabilities** |**Length limits (tokens)**  |**Rate limits** |
|---|---|---|---|
|[seed-2-0-lite-260428](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-2-0-lite) |Deep Reasoning<br><br>Text Generation<br><br>Multi\-modal Understanding<br><br>Function Calling |Context Length: 256K<br><br>Max Input: 256K<br><br>Max Output (incl. CoT): 128K, (Default: 4K)<br><br>Max CoT: 128K |30K Max RPM<br><br>1500K Max TPM |
|[seed-2-0-mini-260428](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-2-0-mini) |Deep Reasoning<br><br>Text Generation<br><br>Multi\-modal Understanding<br><br>Function Calling |Context Length: 256K<br><br>Max Input: 256K<br><br>Max Output (incl. CoT): 128K, (Default: 4K)<br><br>Max CoT: 128K |30K Max RPM<br><br>1500K Max TPM |


<span id="243969e9"></span>
# **Tool use**


<span aceTableMode="list" aceTableWidth="1,1,1"></span>
|**Model ID** |**Function calling**<br><br>[Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request) & [Chat API](https://docs.byteplus.com/en/docs/ModelArk/1494384) |**MCP**<br><br>[Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request) |
|---|---|---|
|[seed-2-0-lite-260428](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-2-0-lite) |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |
|[seed-2-0-mini-260428](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-2-0-mini) |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |
|[seed-2-0-pro-260328](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-2-0-pro) |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |
|[seed-2-0-lite-260215](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-2-0-lite) |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |
|[seed-2-0-mini-260215](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-2-0-mini) |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |
|[seed-2-0-code-preview-260328](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-2-0-code) |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/6767c68a10aa4707b4207ce2474d62b9~tplv-goo7wpa0wc-image.image) </span> |
|[seed-1-8-251228](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-1-8) |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |
|[seed-1-6-250915](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-1-6) |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |
|[seed-1-6-250615](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-1-6) |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |
|[seed-1-6-flash-250715](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-1-6-flash) |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |
|[seed-1-6-flash-250615](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-1-6-flash) |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |
|[glm-4-7-251222](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=glm-4-7) |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |
|[deepseek-v4-pro-260425](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=deepseek-v4-pro) |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |
|[deepseek-v4-flash-260425](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=deepseek-v4-flash) |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |
|[deepseek-v3-2-251201](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=deepseek-v3-2) |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |


Related tutorials:


* [Function calling](https://docs.byteplus.com/en/docs/ModelArk/1262342)

* [Cloud-deployed MCP / remote MCP](https://docs.byteplus.com/en/docs/ModelArk/1827534)


<span id="476e6f25"></span>
# Context caching

Overview: [Context caching overview](https://docs.byteplus.com/en/docs/ModelArk/1398933) | API: [Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request), [Create context caching API](https://docs.byteplus.com/en/docs/ModelArk/1346559)

> Context API is only supported by some legacy models.



<span aceTableMode="list" aceTableWidth="1,1,1"></span>
|**Model ID** |**Implicit cache** |**Explicit cache** |
|---|---|---|
|[seed-2-0-lite-260428](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-2-0-lite) |[Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request)<br><br>[Chat API](https://docs.byteplus.com/en/docs/ModelArk/1494384) |[Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request)<br><br>Prefix Caching<br><br>Session Caching |
|[seed-2-0-mini-260428](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-2-0-mini) |[Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request)<br><br>[Chat API](https://docs.byteplus.com/en/docs/ModelArk/1494384) |[Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request)<br><br>Prefix Caching<br><br>Session Caching |
|[seed-2-0-pro-260328](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-2-0-pro) |[Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request)<br><br>[Chat API](https://docs.byteplus.com/en/docs/ModelArk/1494384) |[Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request)<br><br>Prefix Caching<br><br>Session Caching |
|[seed-2-0-lite-260228](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-2-0-lite) |[Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request)<br><br>[Chat API](https://docs.byteplus.com/en/docs/ModelArk/1494384) |[Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request)<br><br>Prefix Caching<br><br>Session Caching |
|[seed-2-0-mini-260215](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-2-0-mini) |[Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request)<br><br>[Chat API](https://docs.byteplus.com/en/docs/ModelArk/1494384) |[Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request)<br><br>Prefix Caching<br><br>Session Caching |
|[seed-2-0-code-preview-260328](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-2-0-code) |[Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request)<br><br>[Chat API](https://docs.byteplus.com/en/docs/ModelArk/1494384) |[Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request)<br><br>Prefix Caching<br><br>Session Caching |
|[seed-1-8-251228](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-1-8) |[Batch API (Chat)](https://docs.byteplus.com/en/docs/ModelArk/1528783)<br><br>[Batch Inference API (Job)](https://docs.byteplus.com/en/docs/ModelArk/Manage_Batch_Inference_Tasks) |[Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request)<br><br>Prefix Caching<br><br>Session Caching |
|[glm-4-7-251222](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=glm-4-7) |[Batch API (Chat)](https://docs.byteplus.com/en/docs/ModelArk/1528783)<br><br>[Batch Inference API (Job)](https://docs.byteplus.com/en/docs/ModelArk/Manage_Batch_Inference_Tasks) |[Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request)<br><br>Prefix Caching<br><br>Session Caching |
|[deepseek-v4-pro-260425](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=deepseek-v4-pro) |[Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request)<br><br>[Chat API](https://docs.byteplus.com/en/docs/ModelArk/1494384) |[Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request)<br><br>Prefix Caching<br><br>Session Caching |
|[deepseek-v4-flash-260425](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=deepseek-v4-flash) |[Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request)<br><br>[Chat API](https://docs.byteplus.com/en/docs/ModelArk/1494384) |[Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request)<br><br>Prefix Caching<br><br>Session Caching |
|[deepseek-v3-2-251201](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=deepseek-v3-2) |[Batch API (Chat)](https://docs.byteplus.com/en/docs/ModelArk/1528783)<br><br>[Batch Inference API (Job)](https://docs.byteplus.com/en/docs/ModelArk/Manage_Batch_Inference_Tasks) |[Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request)<br><br>Prefix Caching<br><br>Session Caching |
|[seed-1-6-250915](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-1-6) |[Batch API (Chat)](https://docs.byteplus.com/en/docs/ModelArk/1528783)<br><br>[Batch Inference API (Job)](https://docs.byteplus.com/en/docs/ModelArk/Manage_Batch_Inference_Tasks) |[Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request)<br><br>Prefix Caching<br><br>Session Caching |
|[seed-1-6-250615](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-1-6) |[Batch API (Chat)](https://docs.byteplus.com/en/docs/ModelArk/1528783)<br><br>[Batch Inference API (Job)](https://docs.byteplus.com/en/docs/ModelArk/Manage_Batch_Inference_Tasks) |[Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request)<br><br>Prefix Caching<br><br>Session Caching |
|[seed-1-6-flash-250715](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-1-6-flash) |[Batch API (Chat)](https://docs.byteplus.com/en/docs/ModelArk/1528783)<br><br>[Batch Inference API (Job)](https://docs.byteplus.com/en/docs/ModelArk/Manage_Batch_Inference_Tasks) |[Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request)<br><br>Prefix Caching<br><br>Session Caching |
|[seed-1-6-flash-250615](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-1-6-flash) |[Batch API (Chat)](https://docs.byteplus.com/en/docs/ModelArk/1528783)<br><br>[Batch Inference API (Job)](https://docs.byteplus.com/en/docs/ModelArk/Manage_Batch_Inference_Tasks) |[Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request)<br><br>Prefix Caching<br><br>Session Caching |


<span id="25b394c2"></span>
# Structured output (beta)

Overview: [Structured output (beta)](https://docs.byteplus.com/en/docs/ModelArk/1568221) | API: [Chat API](https://docs.byteplus.com/en/docs/ModelArk/1494384), [Responses API](https://docs.byteplus.com/en/docs/ModelArk/Create_model_request)

<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>


<div data-tips="true" data-tips-type="tip">This capability is still in the beta phase. Proceed with caution when using it in the production environment.</div>



<span aceTableMode="list" aceTableWidth="3,3,3,2"></span>
|**Model ID** |**Capabilities** |**Length limits (tokens)**  |**Rate limits** |
|---|---|---|---|
|[seed-2-0-lite-260228](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-2-0-lite) |Deep Reasoning<br><br>Text Generation<br><br>Multi\-modal Understanding<br><br>Function Calling<br><br>Structured Output |Context Length: 256K<br><br>Max Input: 256K<br><br>Max Output (incl. CoT): 128K, (Default: 4K)<br><br>Max CoT: 128K |30K Max RPM<br><br>1500K Max TPM |
|[seed-2-0-mini-260215](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-2-0-mini) |Deep Reasoning<br><br>Text Generation<br><br>Multi\-modal Understanding<br><br>Function Calling<br><br>Structured Output |Context Length: 256K<br><br>Max Input: 256K<br><br>Max Output (incl. CoT): 128K, (Default: 4K)<br><br>Max CoT: 128K |30K Max RPM<br><br>1500K Max TPM |
|[seed-1-8-251228](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-1-8) |Deep Reasoning<br><br>Text Generation<br><br>Multi\-modal Understanding<br><br>Function Calling<br><br>Structured Output |Context Length: 256K<br><br>Max Input: 224K<br><br>Max Output (incl. CoT): 64K, (Default: 4K)<br><br>Max CoT: 32K |30K Max RPM<br><br>1500K Max TPM |
|[deepseek-v3-2-251201](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=deepseek-v3-2) |Deep Reasoning<br><br>Text Generation<br><br>Function Calling |Context Length: 128K<br><br>Max Input: 128K<br><br>Max Output (incl. CoT): 32K, (Default: 4K)<br><br>Max CoT: 32K |15K Max RPM<br><br>1500K Max TPM |
|[seed-1-6-250915](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-1-6) |Deep Reasoning<br><br>Text Generation<br><br>Image Understanding<br><br>Video Understanding<br><br>Structured Output<br><br>Function Calling |Context Length: 256K<br><br>Max Input: 224K<br><br>Max Output (incl. CoT): 32K, (Default: 4K)<br><br>Max CoT: 32K |15K Max RPM<br><br>800K Max TPM |
|[seed-1-6-250615](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-1-6) |Deep Reasoning<br><br>Text Generation<br><br>Image Understanding<br><br>Video Understanding<br><br>Structured Output<br><br>Function Calling |Context Length: 256K<br><br>Max Input: 224K<br><br>Max Output (incl. CoT): 32K, (Default: 4K)<br><br>Max CoT: 32K |15K Max RPM<br><br>800K Max TPM |
|[seed-1-6-flash-250715](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-1-6-flash) |Deep Reasoning<br><br>Text Generation<br><br>Visual Grounding<br><br>Image Understanding<br><br>Video Understanding<br><br>Structured Output<br><br>Function Calling |Context Length: 256K<br><br>Max Input: 224K<br><br>Max Output (incl. CoT): 32K, (Default: 4K)<br><br>Max CoT: 32K |15K Max RPM<br><br>800K Max TPM |
|[seed-1-6-flash-250615](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seed-1-6-flash) |Deep Reasoning<br><br>Text Generation<br><br>Visual Grounding<br><br>Image Understanding<br><br>Video Understanding<br><br>Structured Output<br><br>Function Calling |Context Length: 256K<br><br>Max Input: 224K<br><br>Max Output (incl. CoT): 32K, (Default: 4K)<br><br>Max CoT: 32K |15K Max RPM<br><br>800K Max TPM |


<span id="2705b333"></span>
# Video generation

Tutorials: [Video generation](https://docs.byteplus.com/en/docs/ModelArk/2300461) | API: [Video Generation API](https://docs.byteplus.com/en/docs/ModelArk/Video_Generation_API)


<span aceTableMode="list" aceTableWidth="2,3,3,3"></span>
|**Model ID** |**Capabilities** |**Output video format** |**Rate limits**:<br><br>> default (Online Inference)<br><br>> flex (Offline Inference) |
|---|---|---|---|
|[dreamina-seedance-2-0-260128](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=dreamina-seedance-2-0) `audio-visual sync` |Multimodal Reference to Video<br><br>Video Modification<br><br>Video Extension<br><br>Image\-to\-Video \- First and Last Frames<br><br>Image\-to\-Video \- First Frame<br><br>Text\-to\-Video |Resolution:<br><br>480p, 720p, 1080p, 4k (10bit\-encoding)<br><br>Frame Rate: 24 fps<br><br>Duration: 4–15 s<br><br>Video Format: .mp4 |**Non\-4k**<br><br><br>* default (enterprise users):<br><br>   * Max RPM: 600<br><br>   * Max concurrency: 10<br><br>* default (individual users):<br><br>   * Max RPM: 180<br><br>   * Max concurrency: 3<br><br>      **4k**<br><br>* default (enterprise users):<br><br>   * Max RPM: 15<br><br>   * Max concurrency: 1<br><br>* default (individual users):<br><br>   * Max RPM: 15<br><br>   * Max concurrency: 1 |
|[dreamina-seedance-2-0-fast-260128](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=dreamina-seedance-2-0-fast) `audio-visual sync` |Multimodal Reference to Video<br><br>Video Modification<br><br>Video Extension<br><br>Image\-to\-Video \- First and Last Frames<br><br>Image\-to\-Video \- First Frame<br><br>Text\-to\-Video |Resolution:<br><br>480p, 720p<br><br>Frame Rate: 24 fps<br><br>Duration: 4–15 s<br><br>Video Format: .mp4 |* default (enterprise users):<br><br>   * Max RPM: 600<br><br>   * Max concurrency: 10<br><br>* default (individual users):<br><br>   * Max RPM: 180<br><br>   * Max concurrency: 3<br><br>* flex: Not supported |
|[dreamina-seedance-2-0-mini-260615](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=dreamina-seedance-2-0-mini) `audio-visual sync` |Multimodal Reference to Video<br><br>Video Modification<br><br>Video Extension<br><br>Image\-to\-Video \- First and Last Frames<br><br>Image\-to\-Video \- First Frame<br><br>Text\-to\-Video |Resolution:<br><br>480p, 720p<br><br>Frame Rate: 24 fps<br><br>Duration: 4–15 s<br><br>Video Format: .mp4 |* default (enterprise users):<br><br>   * Max RPM: 600<br><br>   * Max concurrency: 10<br><br>* default (individual users):<br><br>   * Max RPM: 180<br><br>   * Max concurrency: 3<br><br>* flex: Not supported |
|[seedance-1-5-pro-251215](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seedance-1-5-pro) `audio-visual sync` |Image\-to\-Video \- First and Last Frames<br><br>Image\-to\-Video \- First Frame<br><br>Text\-to\-Video |Resolution:<br><br>480p, 720p,<br><br>1080p<br><br>Frame Rate: 24 fps<br><br>Duration: 4–12 s<br><br>Video Format: .mp4 |* default:<br><br>   * Max RPM 600<br><br>   * Max concurrency: 10<br><br>* flex:<br><br>   * TPD: 500B |
|[seedance-1-0-pro-250528](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seedance-1-0-pro) |Image\-to\-Video \- First and Last Frames<br><br>Image\-to\-Video \- First Frame<br><br>Text\-to\-Video |Resolution:<br><br>480p,<br><br>720p,<br><br>1080p`Reference image feature is not supported`<br><br>Frame Rate: 24 fps<br><br>Duration: 2–12 s<br><br>Video Format: .mp4 |* default:<br><br>   * Max RPM 600<br><br>   * Max concurrency: 10<br><br>* flex:<br><br>   * TPD: 500B |
|[seedance-1-0-pro-fast-251015](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seedance-1-0-pro-fast) |Image\-to\-Video \- First Frame<br><br>Text\-to\-Video ||* default:<br><br>   * Max RPM 600<br><br>   * Max concurrency: 10<br><br>* flex:<br><br>   * TPD: 500B |


<span id="d3e5e0eb"></span>
# Image generation

Tutorial: [Image generation](https://docs.byteplus.com/en/docs/ModelArk/1824690) | API: [Image generation API](https://docs.byteplus.com/en/docs/ModelArk/1541523)


<span aceTableMode="list" aceTableWidth="1,2,1"></span>
|**Model ID** |**Capabilities** |**Rate limits (Max IPM)**  |
|---|---|---|
|[seedream-5-0-260128](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seedream-5-0)<br><br>(also supports: seedream\-5\-0\-lite\-260128) |Text\-to\-Image<br><br>Image\-to\-Image<br><br><br>* Single Image\-to\-Image<br><br>* Generate images with multiple reference imagesGenerate a batch of images<br><br>* Generate a batch of images from text<br><br>* Generate a batch of images from a single image<br><br>* Generate a batch of images from multiple reference images |500 |
|[seedream-4-5-251128](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seedream-4-5) ||500 |
|[seedream-4-0-250828](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=seedream-4-0) ||500 |


<span id="235202b8"></span>
# 3D generation


<span aceTableMode="list" aceTableWidth="1,1,2,1,1"></span>
|**Model ID** |**Capabilities** |**Output video format** |**Rate limits** |**Free quota** |
|---|---|---|---|---|
|[Hyper3d-Rodin-Gen2](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=hyper3d-gen2) |Text to 3D、Images to 3D<br><br><br>* White model<br><br>* Textured model<br><br>* PBR material model<br><br>* Textured model with PBR materials |Polygon count:<br><br><br>* Triangular mesh: [500, 1,000,000]<br><br>* Quad mesh: [1,000, 200,000]File format:<br><br>* glb, obj, stl, fbx, usdz |Max RPM: 60<br><br>Max concurrency: 3 |150K |
|[Hitem3d-2.0](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=hitem3d-2-0) |Images to 3D<br><br><br>* Standard White Model<br><br>* Standard Textured Model<br><br>* High\-Precision White Model<br><br>* High\-Precision Textured Model |Polygon count:<br><br><br>* [100,000, 2,000,000]File format:<br><br>* glb, obj, stl, fbx, usdzResolution:<br><br>* 1536, 1536pro |Max RPM: 600<br><br>Max concurrency: 30 |500K |


<span id="5fa3ded4"></span>
# Multimodal embedding

Tutorial: [Multimodal embedding](https://docs.byteplus.com/en/docs/ModelArk/1409291) | API: [Embeddings Multimodal API](https://docs.byteplus.com/en/docs/ModelArk/1523520)


<span aceTableMode="list" aceTableWidth="1,2,1,1,1"></span>
|**Model ID** |**Capabilities** |**Context length (tokens)**  |**Maximum vector dimension** |**Rate limits** |
|---|---|---|---|---|
|[skylark-embedding-vision-251215](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=skylark-embedding-vision) |Videos, Images and Text vectorization, support Chinese and English |128K |2048 |1.2K Max RPM<br><br>1200K Max TPM |
|[skylark-embedding-vision-250615](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=skylark-embedding-vision) |Videos, Images and Text vectorization, support Chinese and English |128K |2048 |1.2K Max RPM<br><br>1200K Max TPM |





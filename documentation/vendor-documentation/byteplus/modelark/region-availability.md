A region is a geographic area where compute resources for model inference are primarily provisioned and scheduled.

ModelArk currently supports the following regions:


* Johor, Asia Pacific (AP):

   * Region ID: `ap-southeast-1`

   * Base URL: `https://ark.ap-southeast.bytepluses.com/api/v3`

* Dublin, Europe (EU):

   * Region ID: `eu-west-1`

   * Base URL: `https://ark.eu-west.bytepluses.com/api/v3`


<span id="9bed8ad6"></span>
# Key concepts

<span id="1ee6b9b5"></span>
## Regional isolation

You access model services through region\-scoped customized online inference endpoints:


* An inference endpoint created in a region must be invoked using the region\-specific base URL. Inference endpoints in one region cannot be called through another region’s URL.

* Platform\-level resources, such as API keys and model activation status are isolated by region.


For example, when making the following request, ensure that the **Base URL** and **API key** correspond to the region in which the inference endpoint was created to guarantee that the request is processed correctly:


<Tabs>
<Tab zoneid="vkcS6PMit9" title="AP region demo">
<TabTitle>AP region demo</TabTitle>

```Bash
curl https://ark.ap-southeast.bytepluses.com/api/v3/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer $ARK_API_KEY" \\
  -d '{
    "model": "<AP_Endpoint_ID>", 
    "messages": [
        {"role": "user", "content": "hello"}
    ]
  }'
```



</Tab>
<Tab zoneid="SKwkMMMWIN" title="EU region demo">
<TabTitle>EU region demo</TabTitle>

```Bash
curl https://ark.eu-west.bytepluses.com/api/v3/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer $ARK_API_KEY" \\
  -d '{
    "model": "<EU_Endpoint_ID>",
    "messages": [
        {"role": "user", "content": "hello"}
    ]
  }'
```



</Tab>
</Tabs>


<span id="5c61a6bb"></span>
## How inference requests are routed

Inference requests sent to an inference endpoint are primarily routed to the region where the endpoint is created. However, based on overall resource scheduling, some requests may be routed to inference resources in other regions.

<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/661b9c35dca042f4bbd488ecadde0704~tplv-goo7wpa0wc-image.image) </span>


| |Region |Request origin |Observed/expected routing behavior |
|---|---|---|---|
|Case 1 |AP |Singapore |Inference prefers AP, but may spill over to EU if needed |
|Case 2 |EU |Austria |Inference prefers EU, but may spill over to AP if needed |


<span id="e8a7472c"></span>
# Switch between regions

You can switch region from the upper\-left corner in the [console](https://console.byteplus.com/ark/region:ark+ap-southeast-1).

<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ffa80563dd524eecbeab85da6deed2e4~tplv-goo7wpa0wc-image.image) </span>

After switching the region, the console displays resources available in and information about the current region.

<span id="980feec2"></span>
# Capability availability by region

This section lists models and APIs supported in the EU region. Platform capability & service availability is also listed for reference.

<span id="a87df25f"></span>
## Models supported in the EU region

The EU region currently supports the following models:


* seed\-2\-0\-lite

* seed\-2\-0\-mini

* seedream\-5\-0


For the full supported model list, see [Model list](https://docs.byteplus.com/en/docs/ModelArk/1330310?lang=en).

<span id="530d1202"></span>
## APIs supported in the EU region


* [Chat API](https://docs.byteplus.com/en/docs/ModelArk/1494384)

* [Image generation API](https://docs.byteplus.com/en/docs/ModelArk/1541523)


<span id="18f65f71"></span>
## Platform capabilities and services


|Capability/Service |AP |EU |
|---|---|---|
|Foundation models (page) |✅ |✅ |
|Model profile page |✅ | |
|Starter apps |✅ | |
|Playground |✅ | |
|PromptPilot |✅ | |
|Online inference |✅ |✅ |
|Batch inference |✅ | |
|Tuning and Dataset |✅ | |
|Model activation management |✅ |✅ |
|API keys |✅ |✅ |
|Usage management |✅ |✅ |
|Network configuration |✅ | |
|Tokenizer tool |✅ | |
|Project configuration |✅ |✅ |


<span id="21181d17"></span>
# Related documents


* [Quick start](https://docs.byteplus.com/en/docs/ModelArk/1399008)

* [BytePlus ModelArk Data Processing](https://docs.byteplus.com/en/docs/ModelArk/BytePlus_ModelArk_Data_Processing)

* [International Availability for BytePlus Model Service](https://docs.byteplus.com/en/docs/ModelArk/availability)


&nbsp;




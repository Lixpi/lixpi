Online inference endpoint serves as the primary entry point for requesting model inference service. Developers can initiate inference requests via APIs or SDKs by simply specifying the ID of the endpoint, enabling rapid integration and flexible model invocation.

ModelArk provides a unified API interface, along with built\-in capabilities for call monitoring, access policy control, and security enforcement, ensuring both the stability and security of the inference process.

<span id="8ff209f7"></span>
# Types of inference endpoints

Inference endpoints are classified into two types: preset inference endpoints and customized inference endpoints.

Before performing inference with a large model, you must create or select either a preset or customized endpoint based on your specific scenario.

<span id="4a22d4c6"></span>
## Preset inference endpoint

This type is automatically selected when a developer invokes a model using its Model ID. If no corresponding endpoint exists, the system will create one automatically.

Preset endpoints are suitable for functional testing or lightweight use cases.

Endpoint IDs typically follow the format: `ep-m-xxx`

<span id="03f67ccf"></span>
## Customized inference endpoint

Customized endpoints are created manually by users and support advanced configuration options.

They are well suited for enterprise\-grade applications or business integrations that require fine\-grained control over model access, permission management, resource guarantees, and custom response handling.

You can select to create either Standard or Model Unit type of customized endpoints. For more information, see [Create Standard inference endpoint](https://docs.byteplus.com/en/docs/ModelArk/1099522) and [Model Unit](https://docs.byteplus.com/en/docs/ModelArk/1568332).

Endpoint IDs generally follow the format:`ep-xxx`

<span id="3167884e"></span>
# Inference endpoint functionality comparison


|Functionality |Preset Inference Endpoint |Customized Inference Endpoint |
|---|---|---|
|API call method |Model ID or Endpoint ID |Endpoint ID |
|Configure endpoint rate limits |✅ |✅ |
|Monitoring |✅ |✅ |
|Security audit (session, transport encryption) |✅ |✅ |
|Call the tuned model |× |✅ |
|Model version smooth switching |× |✅ |
|Fine\-grained management |× |✅ |
|Model Unit |× |✅ |
|Data delivery |× |✅ |
|Turn on/off control |× |✅ |





When using an inference endpoint with the Standard purchase option, the inference service is deployed in the public resource pool. Billing is based on token usage, providing flexible and controllable costs, which makes it an ideal choice for individual developers and small\-scale businesses.

<span id="f045b44b"></span>
# Key features


* Postpaid based on the number of tokens consumed during model inference; no charges if not invoked.

* Average\-level latency and concurrency; model rate limits are shared across all endpoints of the model under the same account.

* Deployed in the public resource pool; business latency and concurrency performance are affected by the platform's resource levels.


<span id="c9cb4953"></span>
# Recommended scenarios


* New users exploring inference services

* Individual developers or small teams

* Businesses prioritizing cost efficiency with relatively low latency and concurrency requirements

* Workloads that can tolerate occasional resource shortages or have unpredictable traffic patterns


<span id="725e9bd4"></span>
# Supported models


* All foundation models available on the ModelArk platform

* Models fine\-tuned using **LoRA**


<span id="9d94e795"></span>
# Deployment

> If your business has latency requirements, please submit a request through an on\-call support ticket.


<span id="b6cab848"></span>
## 1. Create an inference endpoint


1. Go to [ModelArk Console – Online Inference](https://console.byteplus.com/ark/region:ark+ap-southeast-1/endpoint?config=%7B%7D), switch to the **Model inference access point** tab, and click **Create Inference Endpoint**.

2. Input the endpoint name, select the model type, and select **Standard** under **Purchase option**.

3. Check the agreement and click **Create**.


<span id="e44efb6e"></span>
## 2. Obtain the Endpoint ID

On the [Online Inference page](https://console.byteplus.com/ark/region:ark+ap-southeast-1/endpoint?config=%7B%7D), view and copy the Endpoint ID of the inference endpoint.

<span id="a209bfc5"></span>
## 3. Call the model using the Endpoint ID

Typical sample code is as follows. For more sample code, refer to the model invocation section.

```Python
import os
from byteplussdkarkruntime import Ark

client = Ark(
    base_url='https://ark.ap-southeast.bytepluses.com/api/v3',
    api_key=os.getenv('ARK_API_KEY'),
)

response = client.responses.create(
    model="<ENDPOINT_ID>",
    input="What is the largest lake on Earth?"
)
print(response)
```





const core = require('@huaweicloud/huaweicloud-sdk-core');
const csms = require("@huaweicloud/huaweicloud-sdk-csms/v1/public-api");
const fs = require('fs');

const ak = process.env.HW_ACCESS_KEY;
const sk = process.env.HW_SECRET_ACCESS_KEY;
const endpoint = process.env.HW_KMS_ENDPOINT;
const project_id = process.env.HW_PROJECT_ID;
const secretName = process.env.HW_KMS_SECRET_NAME;
const versionId = process.env.HW_KMS_VERSION_ID;

const credentials = new core.BasicCredentials()
                     .withAk(ak)
                     .withSk(sk)
                     .withProjectId(project_id)
const client = csms.CsmsClient.newBuilder()
                            .withCredential(credentials)
                            .withEndpoint(endpoint)
                            .build();
const request = new csms.ShowSecretVersionRequest();
request.secretName = secretName;
request.versionId = versionId;
const result = client.showSecretVersion(request);
result.then(result => {
    const secrets = JSON.parse(result.version.secret_string);
    const envFilePath = process.env.GITHUB_ENV;
    Object.keys(secrets).forEach(key => {
        fs.appendFileSync(envFilePath, `${key}=${secrets[key]}\n`);
    });
}).catch(ex => {
    console.log("exception:" + JSON.stringify(ex));
});

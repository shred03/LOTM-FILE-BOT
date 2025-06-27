const config = require('../config');
const axios = require('axios');
const crypto = require("crypto")

const shrinkme = async (originalUrl) => {
    const randomString = crypto.randomBytes(5).toString('hex');
    const aliasMsg = `${randomString}lord_of_the_mysteries_channel`;
    try {
        const respose = await axios.get("https://pocolinks.com/api", {
            params:{
                api: config.SHRINKME_API,
                url: originalUrl,
                alias: aliasMsg,
            }
        });

        return respose.data.shortenedUrl || null;
    } catch (error) {
        console.error("URL Sorten error: ", error.message);
        return null;
    }
};

module.exports = shrinkme;
"use strict";

/**
 *
 * PAGASA Severe Weather Bulletin JSON to Wikitext
 *
 * @author Chlod Alejandro <chlod@chlod.net>
 * @license Apache-2.0
 * @copyright Copyright 2020 Chlod Alejandro
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use
 * this file except in compliance with the License. You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the 
 * License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, 
 * either express or implied. See the License for the specific language governing permissions 
 * and limitations under the License.
 * 
 * You can download a copy of the license here:
 * https://www.apache.org/licenses/LICENSE-2.0.txt
 * 
 * This script requires the PagasaScraper script. You can download it from
 * the PAGASA Parser repository, or from Gist.
 * 
 **/

const axios = require("axios");
const path = require("path");

const PagasaScraper = require("../PagasaScraper");

const DATA_DIRECTORY = path.resolve(path.join(__dirname, "..", "data"));

class PagasaToWikipedia {

    constructor(axiosOptions) {
        this.axiosOptions = axiosOptions;
        this.regions = require(path.join(DATA_DIRECTORY, "wp-regions.json"));
        this.municipalitiesTransumte = {
            "Albuena": "Albuera",
            "San Jose Del Monte": "San Jose del Monte",
            "Dinapugue": "Dinapigue",
            "Macallelon": "Macalelon",
            "Tagkayawan": "Tagkawayan"
        };
    }

    _issue(issueDetails) {
        if (this.issues === undefined)
            this.issues = [];
        
        this.issues.push(issueDetails);
    }

    async getParsedWarningSignalsTemplate() {
        var template = (await this.getWarningSignalsTemplate());

        var parse = (await axios.get("https://en.wikipedia.org/w/api.php", typeof axiosOptions === "object" ? Object.assign({
			params: {
                action: "parse",
                format: "json",
                text: `${template.template}`,
                contentmodel: "wikitext"
            },
            responseType: "json"
        }, axiosOptions) : {
			params: {
                action: "parse",
                format: "json",
                text: `${template.template}`,
                contentmodel: "wikitext"
            },
            responseType: "json"
        })).data;
        
        if (parse["parse"] === undefined
            || parse["parse"]["text"] === undefined
            || parse["parse"]["text"]["*"] === undefined) {
            throw new Error("Response from Wikipedia cannot be processed.", new Error(parse));
        }

		return {
            template: template,
            parsed: parse["parse"]["text"]["*"]
        };
    }
    
    async getWarningSignalsTemplate(bulletin) {
        if (bulletin === undefined)
            bulletin = await (new PagasaScraper(this.axiosOptions)).pullBulletin();
        else if (typeof bulletin === "string")
            bulletin = JSON.parse(bulletin);
        
        if (bulletin["typhoon"] === null)
            return {
                issues: [
                    "There is no active typhoon bulletin."
                ],
                template: "''No active typhoon warning signals.''"
            };

        await this._downloadWikipediaProvinces();
        
        var parsedTCWS = this._reorganizeSignals(bulletin);

        return {
            issues: this.issues ? this.issues : false,
            template: this._generateTemplate(bulletin, this._toWikitext(parsedTCWS))
        };
    }

    async _downloadWikipediaProvinces() {
        var provincesGet = await axios.get("https://en.wikipedia.org/w/api.php", typeof axiosOptions === "object" ? Object.assign({
            params: {
                action: "query",
                format: "json",
                list: "categorymembers",
                cmpageid: "722637", // Category:Provinces of the Philippines
                cmprop: "title",
                cmnamespace: "0",
                cmlimit: "max"
            },
            responseType: "json"
        }, axiosOptions) : {
            params: {
                action: "query",
                format: "json",
                list: "categorymembers",
                cmpageid: "722637", // Category:Provinces of the Philippines
                cmprop: "title",
                cmnamespace: "0",
                cmlimit: "max"
            },
            responseType: "json"
        });

        this.provinces = [];
        for (var page of provincesGet.data["query"]["categorymembers"]) {
            this.provinces.push(page["title"]);
        }
    }

    _generateTemplate(bulletin, signals) {
        var utcTime = new Date(bulletin["bulletin"]["issued_timestamp"]);
        var localTime = new Date(bulletin["bulletin"]["issued_timestamp"]);
        localTime.setHours(localTime.getHours() + 8)
        
        var uH = ("0" + utcTime.getHours()).slice(-2);
        var uM = ("0" + utcTime.getMinutes()).slice(-2);
        var lH = ("0" + localTime.getHours()).slice(-2);
        var lM = ("0" + localTime.getMinutes()).slice(-2);
        
        return `{{TyphoonWarningsTable\n`
        + `| PHtime = ${uH}:${uM} UTC (${lH}:${lM} [[Philippine Standard Time|PHT]])\n`
        + `| PH5 = ${signals["5"].trim()}\n`
        + `| PH4 = ${signals["4"].trim()}\n`
        + `| PH3 = ${signals["3"].trim()}\n`
        + `| PH2 = ${signals["2"].trim()}\n`
        + `| PH1 = ${signals["1"].trim()}\n`
        + `| PHsource = [http://bagong.pagasa.dost.gov.ph/tropical-cyclone/severe-weather-bulletin/2 PAGASA]\n`
        + `}}`;
    }

    _toWikitext(parsedTCWS) {
        var signalsWikitext = {};

        for (let signal = 1; signal <= 5; signal++) {
            signalsWikitext[signal] = "";
            var tcwsRegions = parsedTCWS[`${signal}`];

            if (!tcwsRegions)
                continue;

            signalsWikitext[signal] += "\n";

            if (tcwsRegions["_"] !== undefined) {
                signalsWikitext[signal] += this._getRegionsWikitext(undefined, tcwsRegions["_"]);
                tcwsRegions["_"] = undefined;
            }

            Object.entries(tcwsRegions).forEach(([regionId, e]) => {
                if (isNaN(+(regionId)))
                    return;

                var region = this.regions[+(regionId)];
                signalsWikitext[signal] += this._getRegionsWikitext(region, e);
            });
        }

        return signalsWikitext;
    }

    _getRegionsWikitext(region, areas) {
        var out = "";
        
        out += this._getRegionHeader(region);

        areas.forEach((v, i) => {
            out += this._getProvinceAsBullet(v, region ? "**" : "*");
        });

        return out;
    }

    _getRegionHeader(region) {
        return region ? (`* '''[[${region.page ? `${region.page}|` : ""}${region.name}]]''' `
        + (region.designation !== undefined ? `{{small|(${region.designation})}}\n` : "\n")) : "\n";
    }

    _getProvinceAsBullet(v, bulletString = "**") {
        var line = "";
        var provincePage = v.province;

        if (!this.provinces.includes(provincePage)
            && v.province !== "Metro Manila"
            && !(/Islands?$/g.test(v.province))) {
            provincePage += " (province)";
            
            if (!this.provinces.includes(provincePage)) {
                this._issue({
                    message: "Page not found for province: " + v.province,
                    province: v.province
                });
                provincePage = undefined;
            }
        }

        var provinceLink = !provincePage ? `${v.province}` :
            (provincePage === v.province ? 
                `[[${v.province}]]` : `[[${provincePage}|${v.province}]]`);

        if (!v.part) {
            line += `${bulletString} ${provinceLink}\n`;
        } else {
            switch (v.includes.term.toLowerCase()) {
                case "mainland": {
                    line += `${bulletString} Mainland ${provinceLink}\n`;
                    break;
                }
                case "rest": {
                    line += `${bulletString} rest of ${provinceLink}\n`;
                    break;
                }
                default: {
                    line += `${bulletString} ${v.includes.part} ${v.includes.term} of ${provinceLink}`;
                    line += this._linkMunicipalities(v);
                    line += "\n";
    
                    break;
                }
            }
        }

        return line;
    }

    _linkMunicipalities(v) {
        var municipalities = "";
        if (Array.isArray(v.includes.municipalities) && v.includes.municipalities.length > 0) {
            var wikitextMunicipalities = v.includes.municipalities.map((municipality) => {
                var m = municipality
                    .replace(/Sta./g, "Santa")
                    .replace(/Sto./g, "Santo")
                    .replace(/(?:(east|north|south|west)+ern)\s/g, "");
                
                if (this.municipalitiesTransumte[municipality] !== undefined)
                    m = this.municipalitiesTransumte[municipality];
                
                return `[[${m}, ${v.province}|${municipality}]]`
            });
            municipalities += ` {{small|(${wikitextMunicipalities.join(", ")})}}`;
        }

        return municipalities;
    }

    _reorganizeSignals(bulletin) {
        var signals = bulletin["storm_signals"];

        var reorganized = {
            "1": signals["1"] ? this._landmassesToRegions(signals["1"]["affected_areas"]) : null,
            "2": signals["2"] ? this._landmassesToRegions(signals["2"]["affected_areas"]) : null,
            "3": signals["3"] ? this._landmassesToRegions(signals["3"]["affected_areas"]) : null,
            "4": signals["4"] ? this._landmassesToRegions(signals["4"]["affected_areas"]) : null,
            "5": signals["5"] ? this._landmassesToRegions(signals["5"]["affected_areas"]) : null 
        };

        return reorganized;
    }

    _landmassesToRegions(landmasses) {
        var mixed = [
            ...(landmasses["luzon"] == null ? [] : landmasses["luzon"]),
            ...(landmasses["visayas"] == null ? [] : landmasses["visayas"]),
            ...(landmasses["mindanao"] == null ? [] : landmasses["mindanao"])
        ];

        if (landmasses["extras"] !== undefined && Object.keys(landmasses["extras"]) > 0) {
            this._issue({
                message: `Extras detected.`,
                entry: landmasses["extras"]
            });
        }

        var byRegion = {};

        for (var entry of mixed) {
            var regionFound = false;
            this.regions.forEach((element, index) => {
                if (!regionFound && element.provinces.includes(entry["province"])) {
                    if (byRegion[index] === undefined)
                        byRegion[index] = [];

                    byRegion[index].push(entry);
                    regionFound = true;
                }
            });

            if (!regionFound) {
                if (!/Islands?$/.test(entry.province))
                    this._issue({
                        message: "Region for " + entry.province + " not found.",
                        entry: entry
                    });

                if (byRegion["_"] === undefined)
                    byRegion["_"] = [];

                byRegion["_"].push(entry);
            }
        }

        return byRegion;
    }

}

module.exports = PagasaToWikipedia;
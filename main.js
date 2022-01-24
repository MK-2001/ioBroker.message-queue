"use strict";

/*
 * Created with @iobroker/create-adapter v2.0.2
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils     = require("@iobroker/adapter-core");
const aliasMap  = {};
const mqDPs     = {};
const { Kafka } = require('kafkajs');

// Load your modules here, e.g.:
// const fs = require("fs");

class MessageQueue extends utils.Adapter {

    /**
     * @param {Partial<utils.AdapterOptions>} [options={}]
     */
    constructor(options) {
        super({
            ...options,
            name: "message-queue",
        });
        this.on("ready", this.onReady.bind(this));
        this.on("stateChange", this.onStateChange.bind(this));
        this.on("objectChange", this.onObjectChange.bind(this));

        // this.on("message", this.onMessage.bind(this));
        this.on("unload", this.onUnload.bind(this));
    }

    /**
     * Is called when databases are connected and adapter received configuration.
     */
    async onReady() {
        // Initialize your adapter here

        // Reset the connection indicator during startup
        this.setState("info.connection", false, true);

        // The adapters config (in the instance object everything under the attribute "native") is accessible via
        // this.config:
        this.log.info("config Server: " + this.config.mqServer);
        this.log.info("config Port: "   + this.config.mqPort);

        // Connect to server
        this.kafka = new Kafka({
            clientId: "node-app",
            brokers: [this.config.mqServer + ":" + this.config.mqPort]
        });
        this.producer = this.kafka.producer();
        await this.producer.connect();
        // Read the configuration for this adapter
        this.getObjectView("system", "custom", {}, (err, doc) => {
            if(err) {
                this.log.warn("Error: " + JSON.stringify(err));
                return;
            }
            // Exports the complete Custom Config Object
            // this.log.info("Adapter found: " + JSON.stringify(doc));
            // @ts-ignore
            let count = 0;
            if (doc && doc.rows) {
                for (let i = 0, l = doc.rows.length; i < l; i++) {
                    // @ts-ignore
                    if (doc.rows[i].value && doc.rows[i].value[this.namespace]) {
                        let id = doc.rows[i].id;
                        const realId = id;
                        // Hole Aliase egal ob diese aktiv sind oder nicht
                        if (doc.rows[i].value[this.namespace].aliasId) {
                            // @ts-ignore
                            aliasMap[id] = doc.rows[i].value[this.namespace].aliasId;
                            this.log.debug(`Found Alias: ${id} --> ${aliasMap[id]}`);
                            id = aliasMap[id];
                        }
                        // Registriere auf Status Änderungen
                        // @ts-ignore
                        mqDPs[id] = doc.rows[i].value[this.namespace];
                        if (!mqDPs[id] || typeof mqDPs[id] !== "object" || mqDPs[id].enabled === false) {
                            // @ts-ignore
                            delete mqDPs[id];
                        } else {
                            count++;
                            this.log.info(`enabled mq of ${id}, Alias=${id !== realId}, ${count} points now activated`);
                            mqDPs[id].realId = realId;
                            // changesOnly
                            mqDPs[id].changesOnly = mqDPs[id].changesOnly === "true" || mqDPs[id].changesOnly === true;
                            // ignoreZero
                            mqDPs[id].ignoreZero = mqDPs[id].ignoreZero === "true" || mqDPs[id].ignoreZero === true;

                            // ignoreBelowZero
                            mqDPs[id].ignoreBelowZero = mqDPs[id].ignoreBelowZero === "true" || mqDPs[id].ignoreBelowZero === true;

                            // changesRelogInterval
                            if (mqDPs[id].changesRelogInterval !== undefined && mqDPs[id].changesRelogInterval !== null && mqDPs[id].changesRelogInterval !== '') {
                                mqDPs[id].changesRelogInterval = parseInt(mqDPs[id].changesRelogInterval, 10) || 0;
                            } else {
                                mqDPs[id].changesRelogInterval = this.config.changesRelogInterval;
                            }

                            // changesMinDelta
                            if (mqDPs[id].changesMinDelta !== undefined && mqDPs[id].changesMinDelta !== null && mqDPs[id].changesMinDelta !== '') {
                                mqDPs[id].changesMinDelta = parseFloat(mqDPs[id].changesMinDelta) || 0;
                            } else {
                                mqDPs[id].changesMinDelta = this.config.changesMinDelta;
                            }
                        }
                    }
                }
            }
            // Do the subscription
            Object.keys(mqDPs).forEach(id =>
                mqDPs[id] && mqDPs[id] && mqDPs[id].realId && this.subscribeForeignStates(mqDPs[id].realId));
        });
        /*
        For every state in the system there has to be also an object of type state
        Here a simple template for a boolean variable named "testVariable"
        Because every adapter instance uses its own unique namespace variable names can't collide with other adapters variables

        await this.setObjectNotExistsAsync("testVariable", {
            type: "state",
            common: {
                name: "testVariable",
                type: "boolean",
                role: "indicator",
                read: true,
                write: true,
            },
            native: {},
        });
        */

        // In order to get state updates, you need to subscribe to them. The following line adds a subscription for our variable we have created above.
        // this.subscribeStates("testVariable");
        // You can also add a subscription for multiple states. The following line watches all states starting with "lights."
        // this.subscribeStates("lights.*");
        // Or, if you really must, you can also watch all states. Don't do this if you don't need to. Otherwise this will cause a lot of unnecessary load on the system:
        // this.subscribeStates("*");

        /*
            setState examples
            you will notice that each setState will cause the stateChange event to fire (because of above subscribeStates cmd)
        */
        // the variable testVariable is set to true as command (ack=false)
        // await this.setStateAsync("testVariable", true);

        // same thing, but the value is flagged "ack"
        // ack should be always set to true if the value is received from or acknowledged from the target system
        // await this.setStateAsync("testVariable", { val: true, ack: true });

        // same thing, but the state is deleted after 30s (getState will return null afterwards)
        // await this.setStateAsync("testVariable", { val: true, ack: true, expire: 30 });

        // examples for the checkPassword/checkGroup functions
        // let result = await this.checkPasswordAsync("admin", "iobroker");
        // this.log.info("check user admin pw iobroker: " + result);

        // result = await this.checkGroupAsync("admin", "admin");
        // this.log.info("check group user admin group admin: " + result);

        // Subscribe to all changes on custom objects
        this.subscribeForeignObjects("*");

        this.setState("info.connection", true, true);
    }

    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     * @param {() => void} callback
     */
    onUnload(callback) {
        try {
            // Here you must clear all timeouts or intervals that may still be active
            // clearTimeout(timeout1);
            // clearTimeout(timeout2);
            // ...
            // clearInterval(interval1);
            this.producer.disconnect();
            callback();
        } catch (e) {
            callback();
        }
    }

    // If you need to react to object changes, uncomment the following block and the corresponding line in the constructor.
    // You also need to subscribe to the objects with `this.subscribeObjects`, similar to `this.subscribeStates`.
    // /**
    //  * Is called if a subscribed object changes
    //  * @param {string} id
    //  * @param {ioBroker.Object | null | undefined} obj
    //  */
    onObjectChange(realId, obj) {
        if (obj) {
            // The object was changed
            this.log.info(`object ${realId} changed: ${JSON.stringify(obj)}`);
            // Hole alias
            let id = realId;

            if (obj && obj.common && obj.common.custom  && obj.common.custom[this.namespace] && typeof obj.common.custom[this.namespace] === "object" && obj.common.custom[this.namespace].enabled) {
                if (obj.common.custom[this.namespace] && obj.common.custom[this.namespace].aliasId !== realId && obj.common.custom[this.namespace].aliasId !== "") {
                    aliasMap[id] = obj.common.custom[this.namespace].aliasId;
                    this.log.debug(`Registered Alias: ${realId} --> ${aliasMap[realId]}`);
                    id = aliasMap[realId];
                } else {
                    this.log.warn(`Ignoring Alias-ID because identical to ID for ${realId}`);
                    obj.common.custom[this.namespace].aliasId = "";
                }

                // Prüfe ob es bereits im Array angelegt ist
                if(!mqDPs[id]) {
                    mqDPs[id] = obj.common.custom[this.namespace];
                    mqDPs[id].realId = realId;
                    this.subscribeForeignStates(mqDPs[id].realId);
                    this.log.debug("Enabled subscription for " + id + " (" + realId + ")");
                }
            } else {
                if(mqDPs[id]) {
                    this.log.debug(`Unregistered Subscription: ${id}`);
                    this.unsubscribeForeignStates(realId);
                    delete mqDPs[id];
                }
            }
        } else {
            // The object was deleted
            this.log.info(`object ${realId} deleted`);
            if(mqDPs[realId]) {
                this.log.debug(`Unregistered Subscription: ${realId}`);
                this.unsubscribeForeignStates(realId);
                delete mqDPs[realId];
            }
        }
    }

    /**
     * Is called if a subscribed state changes
     * @param {string} id
     * @param {ioBroker.State | null | undefined} state
     */
    async onStateChange(id, state) {
        if (state) {
            // The state was changed
            this.log.info(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
            await this.producer.send({
                topic: id,
                messages: [
                    { value: state.val },
                ],
            });
        } else {
            // The state was deleted
            this.log.info(`state ${id} deleted`);
        }
    }

    // If you need to accept messages in your adapter, uncomment the following block and the corresponding line in the constructor.
    // /**
    //  * Some message was sent to this instance over message box. Used by email, pushover, text2speech, ...
    //  * Using this method requires "common.messagebox" property to be set to true in io-package.json
    //  * @param {ioBroker.Message} obj
    //  */
    // onMessage(obj) {
    //     if (typeof obj === "object" && obj.message) {
    //         if (obj.command === "send") {
    //             // e.g. send email or pushover or whatever
    //             this.log.info("send command");

    //             // Send response in callback if required
    //             if (obj.callback) this.sendTo(obj.from, obj.command, "Message received", obj.callback);
    //         }
    //     }
    // }

}

if (require.main !== module) {
    // Export the constructor in compact mode
    /**
     * @param {Partial<utils.AdapterOptions>} [options={}]
     */
    module.exports = (options) => new MessageQueue(options);
} else {
    // otherwise start the instance directly
    new MessageQueue();
}
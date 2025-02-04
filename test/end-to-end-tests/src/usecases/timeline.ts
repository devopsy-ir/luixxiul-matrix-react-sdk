/*
Copyright 2018 New Vector Ltd
Copyright 2019 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

        http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import { strict as assert } from 'assert';
import { ElementHandle } from "puppeteer";

import { ElementSession } from "../session";

interface Message {
    sender: string;
    encrypted?: boolean;
    body: string;
    continuation?: boolean;
}

export async function receiveMessage(session: ElementSession, expectedMessage: Message): Promise<void> {
    session.log.step(`receives message "${expectedMessage.body}" from ${expectedMessage.sender}`);
    // wait for a response to come in that contains the message
    // crude, but effective

    async function getLastMessage(): Promise<Message> {
        const lastTile = await getLastEventTile(session);
        return getMessageFromEventTile(lastTile);
    }

    let lastMessage;
    await session.poll(async () => {
        try {
            lastMessage = await getLastMessage();
        } catch (err) {
            return false;
        }
        // stop polling when found the expected message
        return lastMessage &&
            lastMessage.body === expectedMessage.body &&
            lastMessage.sender === expectedMessage.sender;
    });
    assertMessage(lastMessage, expectedMessage);
    session.log.done();
}

function assertMessage(foundMessage: Message, expectedMessage: Message): void {
    assert(foundMessage, `message ${JSON.stringify(expectedMessage)} not found in timeline`);
    assert.equal(foundMessage.body, expectedMessage.body);
    assert.equal(foundMessage.sender, expectedMessage.sender);
    if (expectedMessage.hasOwnProperty("encrypted")) {
        assert.equal(foundMessage.encrypted, expectedMessage.encrypted);
    }
}

function getLastEventTile(session: ElementSession): Promise<ElementHandle> {
    return session.query(".mx_EventTile_last");
}

async function getMessageFromEventTile(eventTile: ElementHandle): Promise<Message> {
    const senderElement = await eventTile.$(".mx_DisambiguatedProfile_displayName");
    const className: string = await (await eventTile.getProperty("className")).jsonValue();
    const classNames = className.split(" ");
    const bodyElement = await eventTile.$(".mx_EventTile_body");
    let sender = null;
    if (senderElement) {
        sender = await(await senderElement.getProperty("innerText")).jsonValue();
    }
    if (!bodyElement) {
        return null;
    }
    const body: string = await(await bodyElement.getProperty("innerText")).jsonValue();

    return {
        sender,
        body,
        encrypted: classNames.includes("mx_EventTile_verified"),
        continuation: classNames.includes("mx_EventTile_continuation"),
    };
}

/*
 * Copyright (c) 2021, the SerenityOS developers.
 *
 * SPDX-License-Identifier: BSD-2-Clause
 */

import Command from "./commandInterface";
import { CommandParser } from "../models/commandParser";
import { QUOTE_ROLE_ID } from "../config/secrets";
import { Client, Message, MessageReference } from "discord.js";
import githubAPI from "../apis/githubAPI";
import { getSadCaret } from "../util/emoji";

export class QuoteCommand implements Command {
    private readonly messageLinkRegex: RegExp =
        /https:\/\/(?:(?:ptb|canary)\.)?discord\.com\/channels\/(?<guild>[0-9]{17,18})\/(?<channel>[0-9]{17,18})\/(?<message>[0-9]{17,18})/;

    matchesName(commandName: string): boolean {
        return "quote" == commandName;
    }

    help(_: string): string {
        return "";
    }

    async run(parsedUserCommand: CommandParser): Promise<void> {
        if (!QUOTE_ROLE_ID) return;
        const originalMessage = parsedUserCommand.originalMessage;
        if (!originalMessage.member?.roles.cache.has(QUOTE_ROLE_ID)) return;

        const messageReference = await this.getMessageReference(parsedUserCommand);
        if (messageReference == undefined) return;

        const message = await this.getMessageByReference(
            parsedUserCommand.client,
            messageReference
        );
        if (message == undefined) return;

        const fortunes = await githubAPI.fetchSerenityFortunes();
        fortunes.push({
            quote: message.cleanContent,
            author: message.author.username,
            url: message.url,
            // eslint-disable-next-line camelcase
            utc_time: Math.floor(Date.now() / 1000),
        });

        const pullRequestNumber = await githubAPI.openFortunesPullRequest(
            fortunes,
            message.author.username
        );
        if (pullRequestNumber == undefined) {
            const sadcaret = await getSadCaret(parsedUserCommand.originalMessage);
            await originalMessage.reply(`Failed creating a pull request ${sadcaret}`);
            return;
        }
        await originalMessage.reply(
            `Pull Request opened! https://github.com/${githubAPI.repository}/pull/${pullRequestNumber}`
        );
    }

    private async getMessageReference(
        parsedUserCommand: CommandParser
    ): Promise<MessageReference | undefined> {
        const originalMessage = parsedUserCommand.originalMessage;
        // Option 1: The quote was replied to
        if (originalMessage.reference != null) return originalMessage.reference;

        const args = parsedUserCommand.args;
        if (args.length != 1) return;

        // Option 2: The quote was linked
        const messageURLMatch = args[0].match(this.messageLinkRegex);
        if (messageURLMatch != null && messageURLMatch.groups != undefined) {
            return {
                guildID: messageURLMatch.groups.guild,
                channelID: messageURLMatch.groups.channel,
                messageID: messageURLMatch.groups.message,
            };
        }

        // Option 3: The quote's message ID was given
        try {
            const message = await originalMessage.channel.messages.fetch(args[0]);
            if (message.guild == null) return;
            return {
                guildID: message.guild.id,
                channelID: message.channel.id,
                messageID: message.id,
            };
        } catch (e) {
            return;
        }
    }

    private async getMessageByReference(
        client: Client,
        messageReference: MessageReference
    ): Promise<Message | undefined> {
        if (messageReference.messageID == null) return;
        try {
            const guild = await client.guilds.fetch(messageReference.guildID);
            const channel = guild.channels.resolve(messageReference.channelID);
            if (channel == null || !channel.isText()) return;
            return await channel.messages.fetch(messageReference.messageID);
        } catch (e) {
            return;
        }
    }
}

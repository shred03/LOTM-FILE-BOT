const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');
const crypto = require('crypto');
require('dotenv').config();
const File = require('./models/File');
const Admin = require('./models/Admin');
const User = require('./models/User');
const setupBroadcast = require('./plugins/broadcast');
const descriptions = require('./script');
const express = require('express');
const Logger = require('./logs/Logs');
const app = express();
const setupStats = require('./plugins/stats')
const setupPostCommand = require('./post/post');
const config = require('./config');
const setupTVPostCommand = require('./post/tvpost');
const { FORCE_CHANNELS } = require('./plugins/force');
const shrinkme = require('./plugins/urlShorten');
const mainKeyboard = require('./helper/keyboard');
const { extractMessageInfo } = require('./helper/messageInfo');
const { getFileDataFromMessage } = require('./helper/getFileDataMessage');
const setupRoutes = require('./plugins/setupRoutes');
const verificationSystem = require('./plugins/verification');
const setupVerificationRoutes = require('./plugins/verificationRoutes');
const {handleMenuAction, setInitialMenuState } = require("./helper/menuHandler");
const fileRetrievalLimitSystem = require('./plugins/fileRetrievalLimit');


const DATABASE_NAME = process.env.DATABASE_NAME

mongoose.connect(process.env.MONGODB_URI, {
    dbName: DATABASE_NAME,
    retryWrites: true,
    w: 'majority'
})
    .then(() => console.log('Connected to MongoDB'))
    .catch(err => console.error('MongoDB connection error:', err));

const bot = new Telegraf(config.BOT_TOKEN);
const ADMIN_IDS = config.ADMIN_IDS.split(',').map(id => parseInt(id));
const DATABASE_FILE_CHANNELS = config.DATABASE_FILE_CHANNELS.split(',').map(id => id.trim());
const AUTO_DELETE = config.AUTO_DELETE_FILES;
const DELETE_MINUTES = config.AUTO_DELETE_TIME;
const logger = new Logger(bot, config.LOG_CHANNEL_ID);
setupBroadcast(bot, logger);
setupStats(bot, logger)
setupPostCommand(bot, logger, ADMIN_IDS);
setupTVPostCommand(bot, logger, ADMIN_IDS);
app.use(express.json());
setupRoutes(app);
setupVerificationRoutes(app);

const isAdmin = async (ctx, next) => {
    if (!ADMIN_IDS.includes(ctx.from.id)) {
        return ctx.reply('Admin Command ❌');
    }
    return next();
};

const generateUniqueId = () => crypto.randomBytes(8).toString('hex');

const resolveChannelId = async (ctx, identifier) => {
    try {
        if (identifier.startsWith('@')) {
            const chat = await ctx.telegram.getChat(identifier);
            return chat.id.toString();
        }
        return identifier;
    } catch (error) {
        console.error('Error from resolveChannelId:', error);
        return null;
    }
};

const getMessageFromChannel = async (ctx, channelIdOrUsername, messageId) => {
    try {
        const forwardedMsg = await ctx.telegram.forwardMessage(
            ctx.chat.id,
            channelIdOrUsername,
            messageId,
            { disable_notification: true }
        );
        await ctx.telegram.deleteMessage(ctx.chat.id, forwardedMsg.message_id);
        return forwardedMsg;
    } catch (error) {
        console.error('Error from getMessageFromChannel:', error);
        return null;
    }
};


const sendFile = async (ctx, file) => {
    const caption = file.original_caption || '';
    switch (file.file_type) {
        case 'document':
            return await ctx.telegram.sendDocument(ctx.chat.id, file.file_id, { caption });
        case 'photo':
            return await ctx.telegram.sendPhoto(ctx.chat.id, file.file_id, { caption });
        case 'video':
            return await ctx.telegram.sendVideo(ctx.chat.id, file.file_id, { caption });
        case 'animation':
            return await ctx.telegram.sendAnimation(ctx.chat.id, file.file_id, { caption });
        case 'sticker':
            return await ctx.telegram.sendSticker(ctx.chat.id, file.file_id);
    }
};

const storeFileFromMessage = async (message, uniqueId, adminId, channelId) => {
    const fileData = getFileDataFromMessage(message);
    if (fileData) {
        const newFile = new File({
            ...fileData,
            stored_by: adminId,
            file_link: message.link || 'NA',
            channel_id: channelId,
            is_multiple: true,
            unique_id: uniqueId,
            message_id: message.message_id
        });
        await newFile.save();
        return true;
    }
    return false;
};

const checkChannelMembership = async (ctx, userId) => {
    try {
        for (const channel of FORCE_CHANNELS) {
            try {
                const member = await ctx.telegram.getChatMember(channel.id, userId);
                // If user is not a member of any one channel, return false
                if (['left', 'kicked'].includes(member.status)) {
                    return false;
                }
            } catch (error) {
                console.error(`Error checking membership for channel ${channel.id}:`, error);
                return false;
            }
        }
        return true; // If loop completes, user is a member of all channels
    } catch (error) {
        console.error('Error in checkChannelMembership:', error);
        return false;
    }
};

app.get('/pirecykings/:uniqueId', async (req, res) => {
    try {
        const { uniqueId } = req.params;

        // Look up the file in MongoDB using unique_id
        const file = await File.findOne({ unique_id: uniqueId });

        if (file) {
            // If found, redirect to the bot with the start parameter
            const botUsername = config.BOT_USERNAME || ctx.botInfo.username;
            return res.redirect(`https://t.me/${botUsername}?start=${uniqueId}`);
        } else {
            // If not found, return a 404 message
            return res.status(404).send('Invalid or expired link');
        }
    } catch (error) {
        console.error('Redirect error:', error);
        return res.status(500).send('Server error');
    }
});

bot.command(['link', 'sl'], isAdmin, async (ctx) => {
    try {
        const args = ctx.message.text.split(' ').slice(1);
        if (args.length === 0) {
            await logger.command(
                ctx.from.id,
                ctx.message.text,
                `${ctx.from.first_name} (${ctx.from.username || 'Untitled'})` || 'Unknown',
                'Link command used',
                'Failed to store',
                'No Link Provided'
            );
            return ctx.reply('Format:\n/link https://t.me/c/xxxxx/123');
        }

        const messageInfo = extractMessageInfo(args[0]);
        if (!messageInfo) return ctx.reply('Invalid message link format.');

        const channelIdentifier = messageInfo.channelId || `@${messageInfo.username}`;
        const targetChannelId = await resolveChannelId(ctx, channelIdentifier);

        if (!targetChannelId || !DATABASE_FILE_CHANNELS.includes(targetChannelId)) {
            return ctx.reply('❌ This channel is not allowed for file storage.');
        }

        const message = await getMessageFromChannel(ctx, targetChannelId, messageInfo.messageId);
        if (!message) return ctx.reply('Message not found or not accessible.');

        const uniqueId = generateUniqueId();
        const stored = await storeFileFromMessage(message, uniqueId, ctx.from.id, targetChannelId);

        if (stored) {
            const retrievalLink = `https://t.me/${ctx.botInfo.username}?start=${uniqueId}`;
            const universelUrl = `https://${config.REDIRECT_DOMAIN}/pirecykings/${uniqueId}`
            const initialMessage = await ctx.reply(`✅ File stored successfully!\nUniversel URL: <code>${universelUrl}</code> \n\n🔗 Original URL: <code>${retrievalLink}</code>\n⌛ Generating short URL...`, { parse_mode: 'HTML' });
            shrinkme(universelUrl).then(shortUrl => {
                ctx.telegram.editMessageText(
                    ctx.chat.id,
                    initialMessage.message_id,
                    null,
                    `✅ File stored successfully!\nUniversel URL: <code>${universelUrl}</code>\n\n🔗 Original URL: <code>${retrievalLink}</code>\n🔗 Shorten URL: <code>${shortUrl || "Failed to generate"}</code>`,
                    { parse_mode: 'HTML' }
                ).catch(err => console.error('Failed to update message with short URL:', err));
            });

            await logger.command(
                ctx.from.id,
                `${ctx.from.first_name} (${ctx.from.username || 'Untitled'})` || 'Unknown',
                'Link command used',
                'SUCCESS',
                `Single file stored \nURL: ${retrievalLink}`
            );
        }
    } catch (error) {
        await logger.error(
            ctx.from.id,
            `${ctx.from.first_name} (${ctx.from.username || 'Untitled'})` || 'Unknown',
            'Link command used',
            'FAILED',
            error.message
        );
        console.error('Error storing file from link:');
        await ctx.reply('Error storing file. Please check if the link is from an allowed channel.');
    }
});

bot.command(['batch', 'ml'], isAdmin, async (ctx) => {
    try {
        const args = ctx.message.text.split(' ').slice(1);
        if (args.length !== 2) {
            await logger.command(ctx.from.id, ctx.from.username || 'Unknown', 'Batch command used', 'FAILED', 'Invalid format');
            return ctx.reply('Format: /batch https://t.me/c/xxxxx/123 https://t.me/c/xxxxx/128');
        }

        const startInfo = extractMessageInfo(args[0]);
        const endInfo = extractMessageInfo(args[1]);
        if (!startInfo || !endInfo) return ctx.reply('Invalid message links.');

        const startChannelId = await resolveChannelId(ctx, startInfo.channelId || `@${startInfo.username}`);
        const endChannelId = await resolveChannelId(ctx, endInfo.channelId || `@${endInfo.username}`);

        if (!startChannelId || !endChannelId) return ctx.reply('Invalid channel in links.');
        if (startChannelId !== endChannelId) return ctx.reply('Both links must be from the same channel.');
        if (!DATABASE_FILE_CHANNELS.includes(startChannelId)) {
            return ctx.reply('❌ This channel is not allowed for file storage.');
        }

        if (endInfo.messageId < startInfo.messageId || endInfo.messageId - startInfo.messageId > 100) {
            return ctx.reply('Invalid range. Maximum range is 100 messages.');
        }

        const uniqueId = generateUniqueId();
        const progressMsg = await ctx.reply('Processing messages...');

        const messageIds = Array.from(
            { length: endInfo.messageId - startInfo.messageId + 1 },
            (_, i) => startInfo.messageId + i
        );

        const BATCH_SIZE = 10;
        const files = [];

        for (let i = 0; i < messageIds.length; i += BATCH_SIZE) {
            const batch = messageIds.slice(i, i + BATCH_SIZE);
            await Promise.all(batch.map(async (msgId) => {
                try {
                    const message = await ctx.telegram.forwardMessage(
                        ctx.chat.id,
                        startChannelId,
                        msgId,
                        { disable_notification: true }
                    );

                    if (message) {
                        const fileData = getFileDataFromMessage(message);
                        if (fileData) {
                            files.push({
                                ...fileData,
                                stored_by: ctx.from.id,
                                unique_id: uniqueId,
                                channel_id: startChannelId,
                                message_id: msgId
                            });
                        }
                    }
                    await ctx.telegram.deleteMessage(ctx.chat.id, message.message_id);
                } catch (error) {
                    console.error(`Message ${msgId} not found, skipping`);
                }
            }));

            await ctx.telegram.editMessageText(
                ctx.chat.id,
                progressMsg.message_id,
                null,
                `Processing: ${Math.min(i + BATCH_SIZE, messageIds.length)}/${messageIds.length} messages`
            );
        }

        if (files.length > 0) {
            
            await File.insertMany(files);

            const retrievalLink = `https://t.me/${ctx.botInfo.username}?start=${uniqueId}`;
            const universelUrl = `https://${config.REDIRECT_DOMAIN}/pirecykings/${uniqueId}`

            const initialMessage = await ctx.reply(`✅ File stored successfully!\nUniversel URL: <code>${universelUrl}</code>\n\n🔗 Original URL: <code>${retrievalLink}</code>\n⌛ Generating short URL...`, { parse_mode: 'HTML' });
            shrinkme(universelUrl).then(shortUrl => {
                ctx.telegram.editMessageText(
                    ctx.chat.id,
                    initialMessage.message_id,
                    null,
                    `✅ File stored successfully!\n🔗 Universel URL: <code>${universelUrl}</code>\n\n🔗 Original URL: <code>${retrievalLink}</code>\n🔗 Shorten URL: <code>${shortUrl || "Failed to generate"}</code>`,
                    { parse_mode: 'HTML' }
                ).catch(err => console.error('Failed to update message with short URL:'));
            });

            await logger.command(
                ctx.from.id,
                ctx.from.username || 'Unknown',
                'Batch command used',
                'SUCCESS',
                `Total ${files.length} files stored \n URL: ${retrievalLink}`,
            );
        }
        await ctx.telegram.deleteMessage(ctx.chat.id, progressMsg.message_id);

    } catch (error) {
        await logger.error(ctx.from.id, ctx.from.username || 'Unknown', 'Batch command', 'FAILED', error.message);
        await ctx.reply('Error processing files. Please try again.');
    }
});

bot.command('token', isAdmin, async (ctx) => {
    try {
        const status = verificationSystem.toggleVerification();
        const statusText = status ? 'ENABLED ✅' : 'DISABLED ❌';

        await ctx.reply(`🔐 **Verification System ${statusText}**\n\n` +
            `Status: Verification is now **${statusText.toLowerCase()}**\n\n` +
            `${status ? '• Users will need to verify before accessing files\n• Verification lasts for 12 hours' : '• Users can access files directly\n• No verification required'}`,
            { parse_mode: 'Markdown' }
        );

        await logger.command(
            ctx.from.id,
            `${ctx.from.first_name} (${ctx.from.username || 'Untitled'})` || 'Unknown',
            'Token command used',
            'SUCCESS',
            `Verification system ${statusText}`
        );
    } catch (error) {
        await logger.error(
            ctx.from.id,
            `${ctx.from.first_name} (${ctx.from.username || 'Untitled'})` || 'Unknown',
            'Token command used',
            'FAILED',
            error.message
        );
        await ctx.reply('❌ Error toggling verification system.');
    }
});

bot.command(['filelimit', 'filel'], isAdmin, async (ctx) => {
    try {
        const status = fileRetrievalLimitSystem.toggleSystem();
        const statusText = status ? 'ENABLED ✅' : 'DISABLED ❌';

        await ctx.reply(`📊 **File Retrieval Limit System ${statusText}**\n\n` +
            `Status: System is now **${statusText.toLowerCase()}**\n\n` +
            `${status ? 
                `• Users limited to ${fileRetrievalLimitSystem.getFileLimit()} files per cycle\n• Verification required after limit reached\n• Limits reset every 24 hours` : 
                '• Users can retrieve unlimited files\n• No file count tracking'
            }`,
            { parse_mode: 'Markdown' }
        );

        await logger.command(
            ctx.from.id,
            `${ctx.from.first_name} (${ctx.from.username || 'Untitled'})` || 'Unknown',
            'File limit command used',
            'SUCCESS',
            `File retrieval limit system ${statusText}`
        );
    } catch (error) {
        await logger.error(
            ctx.from.id,
            `${ctx.from.first_name} (${ctx.from.username || 'Untitled'})` || 'Unknown',
            'File limit command used',
            'FAILED',
            error.message
        );
        await ctx.reply('❌ Error toggling file retrieval limit system.');
    }
});

bot.command(['setlimit', 'setl'], isAdmin, async (ctx) => {
    try {
        const args = ctx.message.text.split(' ').slice(1);
        if (args.length === 0) {
            return ctx.reply(`Current file limit: ${fileRetrievalLimitSystem.getFileLimit()} files per cycle\n\nUsage: /setlimit <number>`);
        }

        const limit = parseInt(args[0]);
        if (isNaN(limit) || limit < 1) {
            return ctx.reply('❌ Please provide a valid number (minimum 1)');
        }

        const newLimit = fileRetrievalLimitSystem.setFileLimit(limit);
        await ctx.reply(`✅ File limit updated to ${newLimit} files per cycle`, { parse_mode: 'Markdown' });

        await logger.command(
            ctx.from.id,
            `${ctx.from.first_name} (${ctx.from.username || 'Untitled'})` || 'Unknown',
            'Set limit command used',
            'SUCCESS',
            `File limit set to ${newLimit}`
        );
    } catch (error) {
        await logger.error(
            ctx.from.id,
            `${ctx.from.first_name} (${ctx.from.username || 'Untitled'})` || 'Unknown',
            'Set limit command used',
            'FAILED',
            error.message
        );
        await ctx.reply('❌ Error setting file limit.');
    }
});

bot.command(['limitstats', 'lstats'], isAdmin, async (ctx) => {
    try {
        const stats = await fileRetrievalLimitSystem.getSystemStats();
        if (!stats) {
            return ctx.reply('❌ Failed to retrieve system statistics.');
        }

        const statusText = stats.systemEnabled ? 'ENABLED ✅' : 'DISABLED ❌';
        
        await ctx.reply(
            `📊 **File Retrieval Limit Statistics**\n\n` +
            `🔧 **System Status:** ${statusText}\n` +
            `📈 **File Limit:** ${stats.currentFileLimit} files per cycle\n\n` +
            `👥 **User Statistics:**\n` +
            `• Total Users: ${stats.totalUsers}\n` +
            `• Users Needing Verification: ${stats.usersNeedingVerification}\n` +
            `• Average Files Retrieved: ${Math.round(stats.averageFilesRetrieved)}\n\n` +
            `⏰ Limits reset every 24 hours`,
            { parse_mode: 'Markdown' }
        );
    } catch (error) {
        await logger.error(
            ctx.from.id,
            `${ctx.from.first_name} (${ctx.from.username || 'Untitled'})` || 'Unknown',
            'Limit stats command used',
            'FAILED',
            error.message
        );
        await ctx.reply('❌ Error retrieving statistics.');
    }
});

bot.command(['resetlimits', 'rsl'], isAdmin, async (ctx) => {
    try {
        const args = ctx.message.text.split(' ').slice(1);
        const userId = args[0] ? parseInt(args[0]) : null;

        const result = await fileRetrievalLimitSystem.resetUserLimits(userId);
        
        if (result.success) {
            await ctx.reply(`✅ ${result.message}`, { parse_mode: 'Markdown' });
            await logger.command(
                ctx.from.id,
                `${ctx.from.first_name} (${ctx.from.username || 'Untitled'})` || 'Unknown',
                'Reset limits command used',
                'SUCCESS',
                result.message
            );
        } else {
            await ctx.reply(`❌ Failed to reset limits: ${result.error}`);
        }
    } catch (error) {
        await logger.error(
            ctx.from.id,
            `${ctx.from.first_name} (${ctx.from.username || 'Untitled'})` || 'Unknown',
            'Reset limits command used',
            'FAILED',
            error.message
        );
        await ctx.reply('❌ Error resetting user limits.');
    }
});
require('./helper/help')(bot);

bot.command('start', async (ctx) => {
    try {
        await User.findOneAndUpdate(
            { user_id: ctx.from.id },
            {
                user_id: ctx.from.id,
                username: ctx.from.username,
                first_name: ctx.from.first_name,
                last_name: ctx.from.last_name
            },
            { upsert: true, new: true }
        );

        const uniqueId = ctx.message.text.split(' ')[1];
    
        if (uniqueId && uniqueId.startsWith('verify_')) {
            const token = uniqueId.replace('verify_', '');
            const result = await verificationSystem.verifyUserByToken(token);

            if (result.success) {               
                if (result.context === 'limit_exceeded') {                    
                    // UPDATED: Pass the context to handleVerificationSuccess
                    await fileRetrievalLimitSystem.handleVerificationSuccess(result.userId, 'limit_exceeded');
                    
                    await ctx.reply(`✅ **Verification Successful!**\n\n` +
                        `Limit have been reset. You can access files.\n\n`,
                        { parse_mode: 'Markdown' }
                    );                    
                   
                    if (result.uniqueId) {
                        setTimeout(async () => {
                            await ctx.telegram.sendMessage(ctx.chat.id, `/start ${result.uniqueId}`);
                        }, 1000);
                    }
                } else {
                    // UPDATED: Pass the context to handleVerificationSuccess  
                    await fileRetrievalLimitSystem.handleVerificationSuccess(result.userId, 'general');
                    
                    await ctx.reply(`**Verification Successful!** ✅\n\n` +
                        `${result.message}\n\n` +
                        `Now you can access the files.`,
                        { parse_mode: 'Markdown' }
                    );
                }
            } else {
                await ctx.reply(`❌ **Verification Failed**\n\n` +
                    `${result.message}\n\n` +
                    `Please request a new verification link.`,
                    { parse_mode: 'Markdown' }
                );
            }
            return;
        }

        // Rest of the start command remains the same...
        if (uniqueId) {
            const files = await File.find({ unique_id: uniqueId }).sort({ message_id: 1 });
            if (!files.length) return ctx.reply('Files not found.');

            if (!ADMIN_IDS.includes(ctx.from.id)) {
            
                const isMember = await checkChannelMembership(ctx, ctx.from.id);
                if (!isMember) {
                    const channelButtons = FORCE_CHANNELS.map(channel =>
                        Markup.button.url(`Join ${channel.name}`, `https://t.me/${channel.username}`)
                    );

                    channelButtons.push(Markup.button.callback('✅ I\'ve Joined', `check_join_${uniqueId}`));

                    const joinKeyboard = Markup.inlineKeyboard(
                        channelButtons.map(button => [button])
                    );

                    await ctx.reply('Join of our channels:', joinKeyboard);
                    return;
                }
               
                if (fileRetrievalLimitSystem.isSystemEnabled()) {
                    const limitCheck = await fileRetrievalLimitSystem.checkRetrievalLimit(ctx.from.id);
                    
                    if (!limitCheck.allowed && limitCheck.needsVerification) {
                        await fileRetrievalLimitSystem.handleLimitExceeded(ctx, uniqueId, limitCheck);
                        return;
                    }
                }

                if (verificationSystem.isVerificationEnabled()) {
                    const isVerified = await verificationSystem.isUserVerified(ctx.from.id);
                    if (!isVerified) {
                        await verificationSystem.sendVerificationRequest(ctx, uniqueId, ctx.botInfo.username, 'general');
                        return;
                    }
                }
            }

            const admin = files[0].stored_by ? await Admin.findOne({ admin_id: files[0].stored_by }) : null;

            await logger.command(
                ctx.from.id,
                `${ctx.from.first_name} (${ctx.from.username || 'Untitled'})` || 'Unknown',
                'File retrieval command used',
                'SUCCESS',
                `Retrieved ${files.length} files with URL: https://t.me/${ctx.botInfo.username}?start=${uniqueId}`
            );

            let sendingMsg = await ctx.reply(`⌛️ Sending ${files.length} file(s)...`);
            const sentMessages = [];
            
            for (const file of files) {
                try {
                    const sentMessage = await sendFile(ctx, file);
                    if (sentMessage) {
                        sentMessages.push(sentMessage.message_id);
                    }
                } catch (error) {
                    console.error(`Error sending file ${file.file_name}:`);
                }
            }
            await ctx.telegram.deleteMessage(ctx.chat.id, sendingMsg.message_id);
            const completionMsg = await ctx.reply('Files sent! ✅');
            sentMessages.push(completionMsg.message_id);
            if (AUTO_DELETE) {
                const warningMsg = await ctx.reply(`Forward the files otherwise it will be automatically deleted in ${DELETE_MINUTES} minutes`);
                sentMessages.push(warningMsg.message_id);
            }
            
            if (!ADMIN_IDS.includes(ctx.from.id) && fileRetrievalLimitSystem.isSystemEnabled()) {
                await fileRetrievalLimitSystem.updateFileRetrievalCount(ctx.from.id, files.length);
                const userStats = await fileRetrievalLimitSystem.getUserStats(ctx.from.id);
                if (userStats && userStats.remainingFiles > 0) {
                    await ctx.reply(`Only ${userStats.remainingFiles} are remaining`);
                }
            }
            if (AUTO_DELETE) {
                setTimeout(async () => {
                    try {
                        for (const msgId of sentMessages) {
                            await ctx.telegram.deleteMessage(ctx.chat.id, msgId);
                        }

                        const fileDeleteWarningMsg = '<i>Files have been deleted.</i>';
                        await ctx.reply(fileDeleteWarningMsg, { parse_mode: 'HTML' });
                    } catch (error) {
                        console.error('Auto-delete error:');
                    }
                }, DELETE_MINUTES * 60 * 1000);
            }
        } else {
            await logger.command(
                ctx.from.id,
                `${ctx.from.first_name} (${ctx.from.username || 'Untitled'})` || 'Unknown',
                'start command used',
                'SUCCESS',
                'Welcome message sent!'
            );
            await ctx.replyWithPhoto(descriptions.welcome_image, {
                caption: `Hello ${ctx.from.first_name}\n\n${descriptions.welcome_text}`,
                parse_mode: 'Markdown',
                ...mainKeyboard
            });
            setInitialMenuState(ctx.from.id, 'home');
        }
    } catch (error) {
        await logger.error(
            ctx.from.id,
            `${ctx.from.first_name} (${ctx.from.username || 'Untitled'})` || 'Unknown',
            'Start command used',
            'FAILED',
            error.message
        );
        await ctx.reply('Error starting bot. Please try again.');
    }
});

bot.action(/^check_join_(.+)/, async (ctx) => {
    const uniqueId = ctx.match[1];
    try {
        const isMember = await checkChannelMembership(ctx, ctx.from.id);
        if (!isMember) {
            await ctx.answerCbQuery('You haven\'t joined the channels yet!');
        } else {
            await ctx.deleteMessage();
            await ctx.reply(`Thank you for joining!`);
            
            await ctx.telegram.sendMessage(ctx.chat.id, `/start ${uniqueId}`);
        }
    } catch (error) {
        console.error('Error verifying membership:');
        await ctx.answerCbQuery('Error verifying channel membership.');
    }
});

bot.action(/^verify_check_(.+)/, async (ctx) => {
    const uniqueId = ctx.match[1];
    try {
        const isVerified = await verificationSystem.isUserVerified(ctx.from.id);
        
        if (!isVerified) {
            await ctx.answerCbQuery('Complete the verification by clicking the on link.');
            return;
        }

        await ctx.answerCbQuery('Verified ✅');
        await ctx.deleteMessage();
        
        await ctx.telegram.sendMessage(ctx.chat.id, `/start ${uniqueId}`);
    } catch (error) {
        console.error('Error handling verification check:', error);
        await ctx.answerCbQuery('❌ Error checking verification status.');
    }
});

bot.action('home', ctx => handleMenuAction(ctx, 'home', descriptions, mainKeyboard));
bot.action('join_channels', ctx => handleMenuAction(ctx, 'join_channels', descriptions, mainKeyboard));
bot.action('about', ctx => handleMenuAction(ctx, 'about', descriptions, mainKeyboard));
bot.action('commands', ctx => handleMenuAction(ctx, 'commands', descriptions, mainKeyboard));


const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
    console.log(`Health check server is running on port ${PORT}`);
});

const startBot = async () => {
    try {
        await bot.launch();
        console.log('✅ Bot is running...');
    } catch (error) {
        console.error('❌ Error starting bot:');
    }
};

setInterval(() => {
    verificationSystem.cleanupExpiredVerifications();
}, 60 * 60 * 1000);

startBot();


process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
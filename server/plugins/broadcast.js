const { Telegraf } = require('telegraf');
const User = require('../models/User');
const Logger = require('../logs/Logs');
const config = require('../config');

module.exports = (bot, logger) => {
    bot.command('broadcast', async (ctx) => {
        // Check if user is admin
        if (!config.ADMIN_IDS.split(',').includes(String(ctx.from.id))) {
            return ctx.reply('Admin Command ❌');
        }

        // Check if message is a reply
        if (!ctx.message.reply_to_message) {
            return ctx.reply('❌ Please reply to the message you want to broadcast');
        }

        try {
            const message = ctx.message.reply_to_message;
            const users = await User.find();
            const totalUsers = users.length;
            let successCount = 0;
            let failCount = 0;

            // Send progress message
            const progressMsg = await ctx.reply(`📡 Broadcasting started...\n0/${totalUsers}`);

            // Send message to all users
            for (const user of users) {
                try {
                    // Copy message with reply_markup if it exists
                    const options = {};
                    
                    // Check if the message has inline keyboard buttons
                    if (message.reply_markup) {
                        options.reply_markup = message.reply_markup;
                    }

                    await bot.telegram.copyMessage(
                        user.user_id,
                        ctx.chat.id,
                        message.message_id,
                        options
                    );
                    successCount++;
                } catch (error) {
                    console.error(`Failed to send to ${user.user_id}: ${error.message}`);
                    failCount++;
                }

                // Update progress every 10 messages
                if ((successCount + failCount) % 10 === 0) {
                    await ctx.telegram.editMessageText(
                        ctx.chat.id,
                        progressMsg.message_id,
                        null,
                        `📡 Broadcasting...\n${successCount + failCount}/${totalUsers}`
                    );
                }
            }

            // Final report
            await ctx.telegram.editMessageText(
                ctx.chat.id,
                progressMsg.message_id,
                null,
                `✅ Broadcast completed!\n\n` +
                `📩 Success: ${successCount}\n` +
                `❌ Failed: ${failCount}`
            );

            // Log the broadcast
            await logger.command(
                ctx.from.id,
                `${ctx.from.first_name} (${ctx.from.username || 'Untitled'})` || 'Unknown',
                'broadcast',
                'SUCCESS',
                `Sent to ${successCount} users`
            );

        } catch (error) {
            console.error('Broadcast error:', error);
            await ctx.reply('❌ Error during broadcast');
            await logger.error(
                ctx.from.id,
                `${ctx.from.first_name} (${ctx.from.username || 'Untitled'})` || 'Unknown',
                'broadcast',
                'FAILED',
                error.message
            );
        }
    });
};
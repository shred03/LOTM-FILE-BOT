const axios = require('axios');
const { Markup } = require('telegraf');
const Logger = require('../logs/Logs');
const Post = require('../models/Post');
const config = require('../config');

const TMDB_BASE_URL = config.TMDB_BASE_URL;
const TMDB_API_KEY = config.TMDB_API_KEY;

const setupTVPostCommand = (bot, logger, ADMIN_IDS) => {
    const isAdmin = async (ctx, next) => {
        if (!ADMIN_IDS.includes(ctx.from.id)) {
            return ctx.reply('❌ 𝙊𝙣𝙡𝙮 𝙖𝙙𝙢𝙞𝙣𝙨 𝙘𝙖𝙣 𝙪𝙨𝙚 𝙩𝙝𝙞𝙨 𝙘𝙤𝙢𝙢𝙖𝙣𝙙');
        }
        return next();
    };

    const searchTVSeries = async (seriesName, page = 1) => {
        try {
            const searchResponse = await axios.get(`${TMDB_BASE_URL}/search/tv`, {
                params: {
                    api_key: TMDB_API_KEY,
                    query: seriesName,
                    include_adult: false,
                    language: 'en-US',
                    page: page
                }
            });

            return searchResponse.data;
        } catch (error) {
            console.error('Error searching TV series:', error);
            return null;
        }
    };

    const getTVSeriesDetails = async (seriesId) => {
        try {
            const seriesResponse = await axios.get(`${TMDB_BASE_URL}/tv/${seriesId}`, {
                params: {
                    api_key: TMDB_API_KEY,
                    language: 'en-US'
                }
            });

            return seriesResponse.data;
        } catch (error) {
            console.error('Error fetching TV series details:', error);
            return null;
        }
    };

    const formatGenres = (genres) => {
        return genres.map(genre => genre.name).join(', ');
    };

    const createTVSeriesPost = (seriesData, seasonLinks, postId = null) => {
        const firstAirYear = seriesData.first_air_date ? 
            new Date(seriesData.first_air_date).getFullYear() : 'N/A';
            
        const genres = formatGenres(seriesData.genres);
        const numberOfSeasons = seriesData.number_of_seasons || "NA";
        const episodeRuntime = seriesData.episode_run_time && seriesData.episode_run_time.length > 0 ? 
            seriesData.episode_run_time[0] : "NA";
        const episodeCounts = seriesData.seasons.map(season => season.episode_count).join("/");
        
        function formatRuntime(minutes) {
            if (!minutes || isNaN(minutes)) return "NA";
            
            const hours = Math.floor(minutes / 60);
            const remainingMinutes = minutes % 60;
          
            return hours > 0 
              ? `${hours} hr ${remainingMinutes} min`
              : `${remainingMinutes} min`;
        }
        const formattedRuntime = formatRuntime(episodeRuntime);
        
        const caption = `<b>${seriesData.name} (${firstAirYear})</b>
╭──────────────────────
➺ 𝑨𝒖𝒅𝒊𝒐: Japanese-English (E-subs)
➺ 𝑸𝒖𝒂𝒍𝒊𝒕𝒚: 480p | 720p | 1080p 
➺ 𝑫𝒖𝒓𝒂𝒕𝒊𝒐𝒏: ${formattedRuntime}
➺ 𝑺𝒆𝒂𝒔𝒐𝒏: ${numberOfSeasons}
➺ 𝑬𝒑𝒊𝒔𝒐𝒅𝒆: ${episodeCounts}
├──────────────────────
➺ 𝑮𝒆𝒏𝒓𝒆𝒔: ${genres}
╰──────────────────────
    
<blockquote><b>𝑷𝒐𝒘𝒆𝒓𝒆𝒅 𝑩𝒚<i>: @lord_of_the_mysteries_channel</i></b></blockquote>`;

        const buttons = seasonLinks.map((seasonLink, index) => {
            const [buttonText, link] = seasonLink.trim().split('=').map(item => item.trim());
            
            if (!link || link === '' || link === 'placeholder') {
                return Markup.button.callback(
                    buttonText, 
                    postId ? `addlink_${postId}_${index}` : `temp_${index}`
                );
            }
            
            return Markup.button.url(buttonText, link);
        });

        const buttonRows = [];
        for (let i = 0; i < buttons.length; i += 2) {
            const row = buttons.slice(i, i + 2);
            buttonRows.push(row);
        }

        const inlineKeyboard = Markup.inlineKeyboard(buttonRows);

        return {
            caption,
            keyboard: inlineKeyboard
        };
    };

    const getTVSeriesImageUrl = (seriesData) => {
        if (seriesData.backdrop_path) {
            return `https://image.tmdb.org/t/p/original${seriesData.backdrop_path}`;
        }
        else if (seriesData.poster_path) {
            return `https://image.tmdb.org/t/p/w500${seriesData.poster_path}`;
        }
        return null;
    };

    const createPaginationKeyboard = (queryId, currentPage, totalPages) => {
        const buttons = [];
        
        if (currentPage > 1) {
            buttons.push(Markup.button.callback('◀️ Previous', `tvpage_${queryId}_${currentPage - 1}`));
        }
        
        buttons.push(Markup.button.callback(`${currentPage}/${totalPages}`, 'noop'));
        
        if (currentPage < totalPages) {
            buttons.push(Markup.button.callback('Next ▶️', `tvpage_${queryId}_${currentPage + 1}`));
        }
        
        return buttons;
    };

   
    bot.context.postedTVMessages = bot.context.postedTVMessages || {};

   
    bot.command(['tvpost'], isAdmin, async (ctx) => {
        try {
            
            setTimeout(async () => {
                await ctx.deleteMessage()
            }, 5000);

            const commandText = ctx.message.text.substring(8).trim(); 
            
            if (!commandText.includes('|')) {
                await logger.command(
                    ctx.from.id,
                    `${ctx.from.first_name} (${ctx.from.username || 'Untitled'})` || 'Unknown',
                    'TV Post command used',
                    'FAILED',
                    'Invalid format'
                );
                return ctx.reply('Please use the format: /tvpost Series_Name | Season 1 = link1 | Season 2 = link2 | ...\n\n*Note: You can use "placeholder" as link value to add links later dynamically*');
            }

            const parts = commandText.split('|').map(part => part.trim());
            const seriesName = parts[0];
            const seasonLinks = parts.slice(1);
            
            if (seasonLinks.length === 0) {
                await logger.command(
                    ctx.from.id,
                    `${ctx.from.first_name} (${ctx.from.username || 'Untitled'})` || 'Unknown',
                    'TV Post command used',
                    'FAILED',
                    'No season links provided'
                );
                return ctx.reply('Please provide at least one season link in the format: Season X = link\n*You can use "placeholder" as link value to add links later*');
            }

            for (const seasonLink of seasonLinks) {
                if (!seasonLink.includes('=')) {
                    return ctx.reply(`Invalid format for '${seasonLink}'. Please use 'Season X = link' format.`);
                }
            }

            const postSetting = await Post.getLatestForAdmin(ctx.from.id);
            
            if (!postSetting) {
                await logger.command(
                    ctx.from.id,
                    `${ctx.from.first_name} (${ctx.from.username || 'Untitled'})` || 'Unknown',
                    'TV Post command used',
                    'FAILED',
                    'No channel set'
                );
                return ctx.reply('❌ No channel set. Please use /setchannel command first.');
            }

            const processingMsg = await ctx.reply('⌛ Searching for TV series...');
            const searchResults = await searchTVSeries(seriesName);

            if (!searchResults || !searchResults.results || searchResults.results.length === 0) {
                await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id);
                await logger.command(
                    ctx.from.id,
                    `${ctx.from.first_name} (${ctx.from.username || 'Untitled'})` || 'Unknown',
                    'TV Post command used',
                    'FAILED',
                    `No TV series found for: ${seriesName}`
                );
                return ctx.reply(`❌ No TV series found for: "${seriesName}"`);
            }

            bot.context.tvSearchCache = bot.context.tvSearchCache || {};
            const queryId = `tvq${ctx.from.id}_${Date.now()}`;
            
            bot.context.tvSearchCache[queryId] = {
                query: seriesName,
                seasonLinks,
                currentPage: 1,
                totalPages: searchResults.total_pages,
                results: searchResults
            };

            const seriesButtons = searchResults.results.map(series => {
                const year = series.first_air_date ? new Date(series.first_air_date).getFullYear() : 'N/A';
                return [Markup.button.callback(
                    `${series.name} (${year})`,
                    `tvseries_${series.id}_${queryId}`
                )];
            });

            if (searchResults.total_pages > 1) {
                seriesButtons.push(
                    createPaginationKeyboard(queryId, 1, searchResults.total_pages)
                );
            }

            await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id);

            await ctx.reply(
                `📺 Found ${searchResults.total_results} results for "${seriesName}"\n\nPlease select a TV series:`,
                Markup.inlineKeyboard(seriesButtons)
            );

            await logger.command(
                ctx.from.id,
                `${ctx.from.first_name} (${ctx.from.username || 'Untitled'})` || 'Unknown',
                'TV Post command used',
                'SUCCESS',
                `Searched for TV series: ${seriesName}, found ${searchResults.total_results} results`
            );
            
        } catch (error) {
            console.error('Error in TV post command:', error);
            await logger.error(
                ctx.from.id,
                `${ctx.from.first_name} (${ctx.from.username || 'Untitled'})` || 'Unknown',
                'TV Post command used',
                'FAILED',
                error.message
            );
            await ctx.reply('Error searching for TV series. Please try again.');
        }
    });

    bot.action(/^tvpage_(.+)_(\d+)$/, async (ctx) => {
        try {
            const queryId = ctx.match[1];
            const page = parseInt(ctx.match[2]);
            
            if (!bot.context.tvSearchCache || !bot.context.tvSearchCache[queryId]) {
                return ctx.answerCbQuery('Session expired. Please search again.');
            }
            
            const cachedSearch = bot.context.tvSearchCache[queryId];
            const searchResults = await searchTVSeries(cachedSearch.query, page);
            
            if (!searchResults || !searchResults.results || searchResults.results.length === 0) {
                await ctx.answerCbQuery('No results found on this page');
                return;
            }

            cachedSearch.currentPage = page;
            cachedSearch.results = searchResults;

            const seriesButtons = searchResults.results.map(series => {
                const year = series.first_air_date ? new Date(series.first_air_date).getFullYear() : 'N/A';
                return [Markup.button.callback(
                    `${series.name} (${year})`,
                    `tvseries_${series.id}_${queryId}`
                )];
            });

            seriesButtons.push(
                createPaginationKeyboard(queryId, page, searchResults.total_pages)
            );

            await ctx.editMessageText(
                `📺 Found ${searchResults.total_results} results for "${cachedSearch.query}" (Page ${page}/${searchResults.total_pages})\n\nPlease select a TV series:`,
                Markup.inlineKeyboard(seriesButtons)
            );
            
            await ctx.answerCbQuery();
        } catch (error) {
            console.error('Error handling TV pagination:', error);
            await ctx.answerCbQuery('Error loading page');
        }
    });

    bot.action(/^tvseries_(\d+)_(.+)$/, async (ctx) => {
        try {
            const seriesId = ctx.match[1];
            const queryId = ctx.match[2];

            if (!bot.context.tvSearchCache || !bot.context.tvSearchCache[queryId]) {
                return ctx.answerCbQuery('Session expired. Please search again.');
            }
            
            const cachedSearch = bot.context.tvSearchCache[queryId];
            const seasonLinks = cachedSearch.seasonLinks;

            await ctx.answerCbQuery('Loading TV series details...');
            await ctx.editMessageText('⌛ Fetching TV series details...');

            const seriesData = await getTVSeriesDetails(seriesId);
            
            if (!seriesData) {
                return ctx.editMessageText('❌ Error fetching TV series details. Please try again.');
            }

            const postId = `tvp${ctx.from.id}_${Date.now()}`;
            const post = createTVSeriesPost(seriesData, seasonLinks, postId);
            const imageUrl = getTVSeriesImageUrl(seriesData);
            const postSetting = await Post.getLatestForAdmin(ctx.from.id);
            
            const channelInfo = postSetting.channelUsername ? 
                `@${postSetting.channelUsername}` : 
                postSetting.channelId;
            
            const confirmationButtons = Markup.inlineKeyboard([
                [
                    Markup.button.callback('✅ Post to Channel', `tvconfirm_${postId}`),
                    Markup.button.callback('❌ Cancel', `tvcancel_${postId}`)
                ]
            ]);

            bot.context.tvPostData = bot.context.tvPostData || {};
            bot.context.tvPostData[postId] = {
                seriesData,
                seasonLinks,
                imageUrl,
                post,
                channelId: postSetting.channelId,
                channelInfo,
                postId
            };
            
            if (imageUrl) {
                await ctx.telegram.sendPhoto(ctx.chat.id, imageUrl, {
                    caption: `<b>Preview:</b>\n\n${post.caption}\n\n<i>Ready to post to ${channelInfo}</i>`,
                    parse_mode: 'HTML',
                    ...post.keyboard
                });
            } else {
                await ctx.telegram.sendMessage(ctx.chat.id, `<b>Preview:</b>\n\n${post.caption}\n\n<i>Ready to post to ${channelInfo}</i>`, {
                    parse_mode: 'HTML',
                    ...post.keyboard
                });
            }
            
            await ctx.telegram.sendMessage(ctx.chat.id, 'Would you like to post this to your channel?', confirmationButtons);
            
            if (bot.context.tvSearchCache && bot.context.tvSearchCache[queryId]) {
                delete bot.context.tvSearchCache[queryId];
            }
            
            await logger.command(
                ctx.from.id,
                `${ctx.from.first_name} (${ctx.from.username || 'Untitled'})` || 'Unknown',
                'TV Series selected',
                'SUCCESS',
                `Created post preview for TV series: ${seriesData.name}`
            );
            
        } catch (error) {
            console.error('Error selecting TV series:', error);
            await ctx.answerCbQuery('Error loading TV series');
            await ctx.editMessageText('Error creating TV series post. Please try again.');
            
            await logger.error(
                ctx.from.id,
                `${ctx.from.first_name} (${ctx.from.username || 'Untitled'})` || 'Unknown',
                'TV Series selection',
                'FAILED',
                error.message
            );
        }
    });
    
    bot.action(/^tvconfirm_(.+)$/, async (ctx) => {
        try {
            setTimeout(async () => {
            }, 10000)

            const postId = ctx.match[1];
            
            if (!bot.context.tvPostData || !bot.context.tvPostData[postId]) {
                await ctx.answerCbQuery('❌ Post data not found');
                return ctx.editMessageText('Unable to find post data. Please create a new post.');
            }
            
            const postData = bot.context.tvPostData[postId];
            const postSetting = await Post.getLatestForAdmin(ctx.from.id);
            
            let sentMessage;
            if (postData.imageUrl) {
                sentMessage = await ctx.telegram.sendPhoto(postData.channelId, postData.imageUrl, {
                    caption: postData.post.caption,
                    parse_mode: 'HTML',
                    ...postData.post.keyboard
                });
            } else {
                sentMessage = await ctx.telegram.sendMessage(postData.channelId, postData.post.caption, {
                    parse_mode: 'HTML',
                    ...postData.post.keyboard
                });
            }

            if (postSetting && postSetting.stickerId) {
                try {
                    await ctx.telegram.sendSticker(postData.channelId, postSetting.stickerId);
                } catch (stickerError) {
                    console.error('Error sending sticker:', stickerError);
                }
            }

            bot.context.postedTVMessages[postId] = {
                messageId: sentMessage.message_id,
                channelId: postData.channelId,
                seriesData: postData.seriesData,
                seasonLinks: postData.seasonLinks,
                imageUrl: postData.imageUrl,
                adminId: ctx.from.id,
                createdAt: new Date()
            };

            const postConfimationMsg = '✅ Post sent to channel!'
            await ctx.answerCbQuery(postConfimationMsg);
            const detailedMsg = `✅ Post for "${postData.seriesData.name}" has been sent to ${postData.channelInfo} successfully!\n\n🔗 Use \`/addlink ${postId}\` to add links to buttons dynamically.`
            await ctx.editMessageText(detailedMsg, { parse_mode: 'Markdown' });
            
            await logger.command(
                ctx.from.id,
                `${ctx.from.first_name} (${ctx.from.username || 'Untitled'})` || 'Unknown',
                'TV Series post to channel',
                'SUCCESS',
                `Posted ${postData.seriesData.name} to channel ${postData.channelInfo}`
            );
            
            delete bot.context.tvPostData[postId];
            
        } catch (error) {
            console.error('Error sending TV series post to channel:', error);
            await ctx.answerCbQuery('❌ Error sending post');
            await ctx.editMessageText('Error sending post to channel. Please check bot permissions and try again.');
            
            await logger.error(
                ctx.from.id,
                `${ctx.from.first_name} (${ctx.from.username || 'Untitled'})` || 'Unknown',
                'TV Series post to channel',
                'FAILED',
                error.message
            );
        }
    });
    
    bot.action(/^tvcancel_(.+)$/, async (ctx) => {
        try {
            setTimeout(async () => {
                await ctx.deleteMessage()
            }, 10000)

            const postId = ctx.match[1];
            
            if (bot.context.tvPostData && bot.context.tvPostData[postId]) {
                delete bot.context.tvPostData[postId];
            }
            
            await ctx.answerCbQuery('Post cancelled');
            await ctx.editMessageText('❌ Post cancelled.');
            
        } catch (error) {
            console.error('Error cancelling TV series post:', error);
            await ctx.answerCbQuery('Error cancelling post');
            await ctx.editMessageText('Error occurred while cancelling post.');
        }
    });

    bot.command(['addlink'], isAdmin, async (ctx) => {
        try {
            setTimeout(async () => {
                await ctx.deleteMessage()
            }, 5000);

            const commandText = ctx.message.text.substring(9).trim(); 
            
            if (!commandText.includes('|')) {
                return ctx.reply('Please use the format: /addlink POST_ID | Season 1 = newlink1 | Season 2 = newlink2');
            }

            const parts = commandText.split('|').map(part => part.trim());
            const postId = parts[0];
            const newLinks = parts.slice(1);

            if (!bot.context.postedTVMessages || !bot.context.postedTVMessages[postId]) {
                return ctx.reply('❌ Post not found. Please check the post ID.');
            }

            const messageData = bot.context.postedTVMessages[postId];

            if (messageData.adminId !== ctx.from.id) {
                return ctx.reply('❌ You can only edit posts that you created.');
            }

            const linkUpdates = {};
            for (const linkData of newLinks) {
                if (!linkData.includes('=')) {
                    return ctx.reply(`Invalid format for '${linkData}'. Please use 'Season X = link' format.`);
                }
                
                const [seasonText, newLink] = linkData.split('=').map(item => item.trim());
                
                const seasonIndex = messageData.seasonLinks.findIndex(originalLink => {
                    const [originalSeasonText] = originalLink.split('=').map(item => item.trim());
                    return originalSeasonText.toLowerCase() === seasonText.toLowerCase();
                });

                if (seasonIndex === -1) {
                    return ctx.reply(`❌ Season "${seasonText}" not found in original post.`);
                }

                linkUpdates[seasonIndex] = newLink;
            }

            const updatedSeasonLinks = [...messageData.seasonLinks];
            for (const [index, newLink] of Object.entries(linkUpdates)) {
                const [seasonText] = updatedSeasonLinks[index].split('=').map(item => item.trim());
                updatedSeasonLinks[index] = `${seasonText} = ${newLink}`;
            }

            const updatedPost = createTVSeriesPost(messageData.seriesData, updatedSeasonLinks, postId);

            try {
                if (messageData.imageUrl) {
                    await ctx.telegram.editMessageCaption(
                        messageData.channelId,
                        messageData.messageId,
                        undefined,
                        updatedPost.caption,
                        {
                            parse_mode: 'HTML',
                            ...updatedPost.keyboard
                        }
                    );
                } else {
                    await ctx.telegram.editMessageText(
                        messageData.channelId,
                        messageData.messageId,
                        undefined,
                        updatedPost.caption,
                        {
                            parse_mode: 'HTML',
                            ...updatedPost.keyboard
                        }
                    );
                }

                messageData.seasonLinks = updatedSeasonLinks;

                await ctx.reply('✅ Links updated successfully in the channel post!');

                await logger.command(
                    ctx.from.id,
                    `${ctx.from.first_name} (${ctx.from.username || 'Untitled'})` || 'Unknown',
                    'Add link to TV post',
                    'SUCCESS',
                    `Updated links for post ID: ${postId}`
                );

            } catch (editError) {
                console.error('Error editing message:', editError);
                await ctx.reply('❌ Error updating the post. The message might be too old or the bot might not have edit permissions.');
                
                await logger.error(
                    ctx.from.id,
                    `${ctx.from.first_name} (${ctx.from.username || 'Untitled'})` || 'Unknown',
                    'Add link to TV post',
                    'FAILED',
                    `Edit error for post ID ${postId}: ${editError.message}`
                );
            }

        } catch (error) {
            console.error('Error in addlink command:', error);
            await ctx.reply('❌ An error occurred while updating links. Please try again.');
            
            await logger.error(
                ctx.from.id,
                `${ctx.from.first_name} (${ctx.from.username || 'Untitled'})` || 'Unknown',
                'Add link command',
                'FAILED',
                error.message
            );
        }
    });

    bot.command(['listposts'], isAdmin, async (ctx) => {
        try {
            setTimeout(async () => {
                await ctx.deleteMessage()
            }, 5000);

            if (!bot.context.postedTVMessages) {
                return ctx.reply('❌ No posts found.');
            }

            const userPosts = Object.entries(bot.context.postedTVMessages)
                .filter(([postId, data]) => data.adminId === ctx.from.id)
                .slice(-10); 

            if (userPosts.length === 0) {
                return ctx.reply('❌ No posts found for your account.');
            }

            let message = '📋 **Your Recent TV Posts:**\n\n';
            
            userPosts.forEach(([postId, data]) => {
                const date = new Date(data.createdAt).toLocaleDateString();
                message += `🆔 \`${postId}\`\n`;
                message += `📺 **${data.seriesData.name}**\n`;
                message += `📅 ${date}\n`;
                message += `📍 Channel: ${data.channelId}\n\n`;
            });

            message += '\n💡 Use `/addlink POST_ID | Season X = newlink` to update links';

            await ctx.reply(message, { parse_mode: 'Markdown' });

            await logger.command(
                ctx.from.id,
                `${ctx.from.first_name} (${ctx.from.username || 'Untitled'})` || 'Unknown',
                'List posts command',
                'SUCCESS',
                `Listed ${userPosts.length} posts`
            );

        } catch (error) {
            console.error('Error in listposts command:', error);
            await ctx.reply('❌ An error occurred while fetching posts.');
            
            await logger.error(
                ctx.from.id,
                `${ctx.from.first_name} (${ctx.from.username || 'Untitled'})` || 'Unknown',
                'List posts command',
                'FAILED',
                error.message
            );
        }
    });

    bot.action(/^tvpage_(.+)_(\d+)$/, async (ctx) => {
        try {
            const queryId = ctx.match[1];
            const page = parseInt(ctx.match[2]);
            
            if (!bot.context.tvSearchCache || !bot.context.tvSearchCache[queryId]) {
                return ctx.answerCbQuery('Session expired. Please search again.');
            }
            
            const cachedSearch = bot.context.tvSearchCache[queryId];
            const searchResults = await searchTVSeries(cachedSearch.query, page);
            
            if (!searchResults || !searchResults.results || searchResults.results.length === 0) {
                await ctx.answerCbQuery('No results found on this page');
                return;
            }

            // Update cached data
            cachedSearch.currentPage = page;
            cachedSearch.results = searchResults;

            // Create updated buttons
            const seriesButtons = searchResults.results.map(series => {
                const year = series.first_air_date ? new Date(series.first_air_date).getFullYear() : 'N/A';
                return [Markup.button.callback(
                    `${series.name} (${year})`,
                    `tvseries_${series.id}_${queryId}`
                )];
            });

            seriesButtons.push(
                createPaginationKeyboard(queryId, page, searchResults.total_pages)
            );

            await ctx.editMessageText(
                `📺 Found ${searchResults.total_results} results for "${cachedSearch.query}" (Page ${page}/${searchResults.total_pages})\n\nPlease select a TV series:`,
                Markup.inlineKeyboard(seriesButtons)
            );
            
            await ctx.answerCbQuery();
        } catch (error) {
            console.error('Error handling TV pagination:', error);
            await ctx.answerCbQuery('Error loading page');
        }
    });

    // Handle TV series selection
    bot.action(/^tvseries_(\d+)_(.+)$/, async (ctx) => {
        try {
            const seriesId = ctx.match[1];
            const queryId = ctx.match[2];

            if (!bot.context.tvSearchCache || !bot.context.tvSearchCache[queryId]) {
                return ctx.answerCbQuery('Session expired. Please search again.');
            }
            
            const cachedSearch = bot.context.tvSearchCache[queryId];
            const seasonLinks = cachedSearch.seasonLinks;

            await ctx.answerCbQuery('Loading TV series details...');
            await ctx.editMessageText('⌛ Fetching TV series details...');

            // Get detailed series information
            const seriesData = await getTVSeriesDetails(seriesId);
            
            if (!seriesData) {
                return ctx.editMessageText('❌ Error fetching TV series details. Please try again.');
            }

            // Generate unique post ID for this post
            const postId = `tvp${ctx.from.id}_${Date.now()}`;
            const post = createTVSeriesPost(seriesData, seasonLinks, postId);
            const imageUrl = getTVSeriesImageUrl(seriesData);
            const postSetting = await Post.getLatestForAdmin(ctx.from.id);
            
            const channelInfo = postSetting.channelUsername ? 
                `@${postSetting.channelUsername}` : 
                postSetting.channelId;
            
            // Create confirmation buttons
            const confirmationButtons = Markup.inlineKeyboard([
                [
                    Markup.button.callback('✅ Post to Channel', `tvconfirm_${postId}`),
                    Markup.button.callback('❌ Cancel', `tvcancel_${postId}`)
                ]
            ]);

            // Store post data for confirmation and dynamic linking
            bot.context.tvPostData = bot.context.tvPostData || {};
            bot.context.tvPostData[postId] = {
                seriesData,
                seasonLinks,
                imageUrl,
                post,
                channelId: postSetting.channelId,
                channelInfo,
                postId
            };
            
            // Send preview
            if (imageUrl) {
                await ctx.telegram.sendPhoto(ctx.chat.id, imageUrl, {
                    caption: `<b>Preview:</b>\n\n${post.caption}\n\n<i>Ready to post to ${channelInfo}</i>`,
                    parse_mode: 'HTML',
                    ...post.keyboard
                });
            } else {
                await ctx.telegram.sendMessage(ctx.chat.id, `<b>Preview:</b>\n\n${post.caption}\n\n<i>Ready to post to ${channelInfo}</i>`, {
                    parse_mode: 'HTML',
                    ...post.keyboard
                });
            }
            
            await ctx.telegram.sendMessage(ctx.chat.id, 'Would you like to post this to your channel?', confirmationButtons);
            
            // Clean up search cache
            if (bot.context.tvSearchCache && bot.context.tvSearchCache[queryId]) {
                delete bot.context.tvSearchCache[queryId];
            }
            
            await logger.command(
                ctx.from.id,
                `${ctx.from.first_name} (${ctx.from.username || 'Untitled'})` || 'Unknown',
                'TV Series selected',
                'SUCCESS',
                `Created post preview for TV series: ${seriesData.name}`
            );
            
        } catch (error) {
            console.error('Error selecting TV series:', error);
            await ctx.answerCbQuery('Error loading TV series');
            await ctx.editMessageText('Error creating TV series post. Please try again.');
            
            await logger.error(
                ctx.from.id,
                `${ctx.from.first_name} (${ctx.from.username || 'Untitled'})` || 'Unknown',
                'TV Series selection',
                'FAILED',
                error.message
            );
        }
    });
    
    // Handle post confirmation and sending to channel
    bot.action(/^tvconfirm_(.+)$/, async (ctx) => {
        try {
            setTimeout(async () => {
                await ctx.deleteMessage()
            }, 10000)

            const postId = ctx.match[1];
            
            if (!bot.context.tvPostData || !bot.context.tvPostData[postId]) {
                await ctx.answerCbQuery('❌ Post data not found');
                return ctx.editMessageText('Unable to find post data. Please create a new post.');
            }
            
            const postData = bot.context.tvPostData[postId];
            const postSetting = await Post.getLatestForAdmin(ctx.from.id);
            
            // Send post to channel
            let sentMessage;
            if (postData.imageUrl) {
                sentMessage = await ctx.telegram.sendPhoto(postData.channelId, postData.imageUrl, {
                    caption: postData.post.caption,
                    parse_mode: 'HTML',
                    ...postData.post.keyboard
                });
            } else {
                sentMessage = await ctx.telegram.sendMessage(postData.channelId, postData.post.caption, {
                    parse_mode: 'HTML',
                    ...postData.post.keyboard
                });
            }

            // Send sticker if configured
            if (postSetting && postSetting.stickerId) {
                try {
                    await ctx.telegram.sendSticker(postData.channelId, postSetting.stickerId);
                } catch (stickerError) {
                    console.error('Error sending sticker:', stickerError);
                }
            }

            // Store message data for dynamic link functionality
            bot.context.postedTVMessages[postId] = {
                messageId: sentMessage.message_id,
                channelId: postData.channelId,
                seriesData: postData.seriesData,
                seasonLinks: postData.seasonLinks,
                imageUrl: postData.imageUrl,
                adminId: ctx.from.id,
                createdAt: new Date()
            };

            const postConfimationMsg = '✅ Post sent to channel!'
            await ctx.answerCbQuery(postConfimationMsg);
            const detailedMsg = `✅ Post for "${postData.seriesData.name}" has been sent to ${postData.channelInfo} successfully!\n\n🔗 Use \`/addlink ${postId}\` to add links to buttons dynamically.`
            await ctx.editMessageText(detailedMsg, { parse_mode: 'Markdown' });
            
            await logger.command(
                ctx.from.id,
                `${ctx.from.first_name} (${ctx.from.username || 'Untitled'})` || 'Unknown',
                'TV Series post to channel',
                'SUCCESS',
                `Posted ${postData.seriesData.name} to channel ${postData.channelInfo}`
            );
            
            // Clean up temporary post data but keep posted message data
            delete bot.context.tvPostData[postId];
            
        } catch (error) {
            console.error('Error sending TV series post to channel:', error);
            await ctx.answerCbQuery('❌ Error sending post');
            await ctx.editMessageText('Error sending post to channel. Please check bot permissions and try again.');
            
            await logger.error(
                ctx.from.id,
                `${ctx.from.first_name} (${ctx.from.username || 'Untitled'})` || 'Unknown',
                'TV Series post to channel',
                'FAILED',
                error.message
            );
        }
    });
    
    // Handle post cancellation
    bot.action(/^tvcancel_(.+)$/, async (ctx) => {
        try {
            setTimeout(async () => {
                await ctx.deleteMessage()
            }, 10000)

            const postId = ctx.match[1];
            
            if (bot.context.tvPostData && bot.context.tvPostData[postId]) {
                delete bot.context.tvPostData[postId];
            }
            
            await ctx.answerCbQuery('Post cancelled');
            await ctx.editMessageText('❌ Post cancelled.');
            
        } catch (error) {
            console.error('Error cancelling TV series post:', error);
            await ctx.answerCbQuery('Error cancelling post');
            await ctx.editMessageText('Error occurred while cancelling post.');
        }
    });

    // Clean up old cache and data periodically (runs every hour)
    setInterval(() => {
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        
        // Clean up posted messages
        if (bot.context.postedTVMessages) {
            Object.entries(bot.context.postedTVMessages).forEach(([postId, data]) => {
                if (new Date(data.createdAt) < oneDayAgo) {
                    delete bot.context.postedTVMessages[postId];
                }
            });
        }
        
        // Clean up search cache
        if (bot.context.tvSearchCache) {
            Object.entries(bot.context.tvSearchCache).forEach(([queryId, data]) => {
                // Clean up search cache older than 1 hour
                const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
                const queryTimestamp = parseInt(queryId.split('_')[1]);
                if (new Date(queryTimestamp) < oneHourAgo) {
                    delete bot.context.tvSearchCache[queryId];
                }
            });
        }
        
        // Clean up post data cache
        if (bot.context.tvPostData) {
            Object.entries(bot.context.tvPostData).forEach(([postId, data]) => {
                const postTimestamp = parseInt(postId.split('_')[1]);
                const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
                if (new Date(postTimestamp) < oneHourAgo) {
                    delete bot.context.tvPostData[postId];
                }
            });
        }
        
        // Clean up link addition context
        if (bot.context.linkAdditionContext) {
            Object.entries(bot.context.linkAdditionContext).forEach(([contextId, data]) => {
                const contextTimestamp = parseInt(contextId.split('_')[2]);
                const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
                if (new Date(contextTimestamp) < fiveMinutesAgo) {
                    delete bot.context.linkAdditionContext[contextId];
                }
            });
        }
    }, 3600000); // Run every hour

    // Initialize contexts if they don't exist
    bot.context.postedTVMessages = bot.context.postedTVMessages || {};
    bot.context.tvSearchCache = bot.context.tvSearchCache || {};
    bot.context.tvPostData = bot.context.tvPostData || {};
    bot.context.linkAdditionContext = bot.context.linkAdditionContext || {};

};

module.exports = setupTVPostCommand;
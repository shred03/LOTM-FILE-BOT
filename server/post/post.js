const axios = require('axios');
const { Markup } = require('telegraf');
const Logger = require('../logs/Logs');
const Post = require('../models/Post');
const { TMDB_API_KEY, TMDB_BASE_URL} = require('../config')

const setupPostCommand = (bot, logger, ADMIN_IDS) => {
    const isAdmin = async (ctx, next) => {
        if (!ADMIN_IDS.includes(ctx.from.id)) {
            return ctx.reply('Admin Command ❌');
        }
        return next();
    };

    const searchMovies = async (movieName, page = 1) => {
        try {
            const searchResponse = await axios.get(`${TMDB_BASE_URL}/search/movie`, {
                params: {
                    api_key: TMDB_API_KEY,
                    query: movieName,
                    include_adult: false,
                    language: 'en-US',
                    page: page
                }
            });

            return searchResponse.data;
        } catch (error) {
            console.error('Error searching movies:', error);
            return null;
        }
    };

    const getMovieDetails = async (movieId) => {
        try {
            const movieResponse = await axios.get(`${TMDB_BASE_URL}/movie/${movieId}`, {
                params: {
                    api_key: TMDB_API_KEY,
                    language: 'en-US'
                }
            });

            return movieResponse.data;
        } catch (error) {
            console.error('Error fetching movie details:', error);
            return null;
        }
    };

    const formatGenres = (genres) => {
        return genres.map(genre => genre.name).join(', ');
    };

    const createMoviePost = (movieData, downloadLink) => {
        const releaseYear = movieData.release_date ? 
            new Date(movieData.release_date).getFullYear() : 'N/A';
            
        const genres = formatGenres(movieData.genres);
        const synopsis = movieData.overview || 'No synopsis available';
        const runtime = movieData.runtime || "NA";
        
        function formatRuntime(minutes) {
            if (!minutes || isNaN(minutes)) return "NA";
            
            const hours = Math.floor(minutes / 60);
            const remainingMinutes = minutes % 60;
          
            return hours > 0 
              ? `${hours} hr ${remainingMinutes} min`
              : `${remainingMinutes} min`;
        }
        const formattedRuntime = formatRuntime(runtime);
        
        const caption = `<b>${movieData.title} (${releaseYear})

» 𝗔𝘂𝗱𝗶𝗼: Hindi+English (E-subs)
» 𝗤𝘂𝗮𝗹𝗶𝘁𝘆: 480p | 720p | 1080p 
» 𝗚𝗲𝗻𝗿𝗲: ${genres}
» 𝗥𝘂𝗻𝘁𝗶𝗺𝗲: ${formattedRuntime}

» 𝗦𝘆𝗻𝗼𝗽𝘀𝗶𝘀:</b>
<blockquote>${synopsis}</blockquote>
    
<b>@Teamxpirates</b>
<blockquote>[𝗜𝗳 𝗬𝗼𝘂 𝗦𝗵𝗮𝗿𝗲 𝗢𝘂𝗿 𝗙𝗶𝗹𝗲𝘀 𝗪𝗶𝘁𝗵𝗼𝘂𝘁 𝗖𝗿𝗲𝗱𝗶𝘁, 𝗧𝗵𝗲𝗻 𝗬𝗼𝘂 𝗪𝗶𝗹𝗹 𝗯𝗲 𝗕𝗮𝗻𝗻𝗲𝗱]</blockquote>`;

        const inlineKeyboard = Markup.inlineKeyboard([
            Markup.button.url('𝐃𝐨𝐰𝐧𝐥𝐨𝐚𝐝 𝐍𝐨𝐰', downloadLink)
        ]);

        return {
            caption,
            keyboard: inlineKeyboard
        };
    };

    const getMoviePosterUrl = (movieData) => {
        if (movieData.poster_path) {
            return `https://image.tmdb.org/t/p/w500${movieData.poster_path}`;
        }
        return null;
    };

    const createPaginationKeyboard = (queryId, currentPage, totalPages) => {
        const buttons = [];
        
        if (currentPage > 1) {
            buttons.push(Markup.button.callback('◀️ Previous', `page_${queryId}_${currentPage - 1}`));
        }
        
        buttons.push(Markup.button.callback(`${currentPage}/${totalPages}`, 'noop'));
        
        if (currentPage < totalPages) {
            buttons.push(Markup.button.callback('Next ▶️', `page_${queryId}_${currentPage + 1}`));
        }
        
        return buttons;
    };

    bot.command(['setsticker', 'ss'], isAdmin, async (ctx) => {
        try {
            setTimeout(async () => {
                await ctx.deleteMessage()
            }, 5000)

            const repliedMessage = ctx.message.reply_to_message;
            
            if (!repliedMessage || !repliedMessage.sticker) {
                return ctx.reply('❌ Please forward or reply to a sticker with this command');
            }

            const stickerId = repliedMessage.sticker.file_id;
            const postSetting = await Post.getLatestForAdmin(ctx.from.id);
            
            if (!postSetting) {
                return ctx.reply('❌ No channel set. Please use /setchannel command first.');
            }

            await Post.findOneAndUpdate(
                { adminId: ctx.from.id },
                { 
                    stickerId,
                    updatedAt: new Date()
                },
                { upsert: true, new: true }
            );

            await logger.command(
                ctx.from.id,
                `${ctx.from.first_name} (${ctx.from.username || 'Untitled'})` || 'Unknown',
                'Set sticker command used',
                'SUCCESS',
                `Sticker set: ${stickerId}`
            );

            return ctx.reply(`✅ Sticker has been set for your channel posts.`);
            
        } catch (error) {
            console.error('Error setting sticker:', error);
            await logger.error(
                ctx.from.id,
                `${ctx.from.first_name} (${ctx.from.username || 'Untitled'})` || 'Unknown',
                'Set sticker command used',
                'FAILED',
                error.message
            );
            return ctx.reply('Error setting sticker. Please try again.');
        }
    });

    bot.command(['setchannel', 'sc'], isAdmin, async (ctx) => {
        try {
            setTimeout(async () => {
                await ctx.deleteMessage()
            }, 5000)

            const args = ctx.message.text.split(' ').slice(1);
            
            if (args.length < 1) {
                return ctx.reply('Please provide a channel ID or username in the format: \n/setchannel @channelUsername\nor\n/setchannel -100xxxxxxxxxx');
            }

            let channelId = args[0];
            let channelUsername = null;

            if (channelId.startsWith('@')) {
                channelUsername = channelId.substring(1);
                try {
                    const chat = await ctx.telegram.getChat(channelId);
                    channelId = chat.id.toString();
                } catch (error) {
                    return ctx.reply(`❌ Couldn't find the channel ${channelId}. Make sure the bot is added to the channel as an admin.`);
                }
            }

            try {
                const botMember = await ctx.telegram.getChatMember(channelId, ctx.botInfo.id);
                const requiredPermissions = ['can_post_messages'];
                
                const missingPermissions = requiredPermissions.filter(perm => !botMember[perm]);
                
                if (missingPermissions.length > 0) {
                    return ctx.reply(`❌ Bot lacks the necessary permissions in this channel. Please make the bot an admin with posting privileges.`);
                }
            } catch (error) {
                return ctx.reply('❌ Cannot verify bot permissions in this channel. Make sure the bot is an admin in the channel.');
            }

            await Post.findOneAndUpdate(
                { adminId: ctx.from.id },
                { 
                    channelId,
                    channelUsername,
                    adminId: ctx.from.id,
                    updatedAt: new Date()
                },
                { upsert: true, new: true }
            );

            await logger.command(
                ctx.from.id,
                `${ctx.from.first_name} (${ctx.from.username || 'Untitled'})` || 'Unknown',
                'Set channel command used',
                'SUCCESS',
                `Channel set to ${channelUsername ? '@' + channelUsername : channelId}`
            );

            return ctx.reply(`✅ Channel ${channelUsername ? '@' + channelUsername : channelId} has been set as your default posting channel.`);
            
        } catch (error) {
            console.error('Error setting channel:', error);
            await logger.error(
                ctx.from.id,
                `${ctx.from.first_name} (${ctx.from.username || 'Untitled'})` || 'Unknown',
                'Set channel command used',
                'FAILED',
                error.message
            );
            return ctx.reply('Error setting channel. Please try again.');
        }
    });

    bot.command(['mp'], isAdmin, async (ctx) => {
        try {
            setTimeout(async () => {
                await ctx.deleteMessage()
            }, 5000);

            const args = ctx.message.text.split(' ').slice(1);
            
            if (args.length < 2) {
                await logger.command(
                    ctx.from.id,
                    `${ctx.from.first_name} (${ctx.from.username || 'Untitled'})` || 'Unknown',
                    'Post command used',
                    'FAILED',
                    'Invalid format'
                );
                return ctx.reply('Please use the format: /post <movieName> <downloadLink>');
            }

            const downloadLink = args[args.length - 1];
            const movieName = args.slice(0, args.length - 1).join(' ');
            const postSetting = await Post.getLatestForAdmin(ctx.from.id);
            
            if (!postSetting) {
                await logger.command(
                    ctx.from.id,
                    `${ctx.from.first_name} (${ctx.from.username || 'Untitled'})` || 'Unknown',
                    'Post command used',
                    'FAILED',
                    'No channel set'
                );
                return ctx.reply('❌ No channel set. Please use /setchannel command first.');
            }

            const processingMsg = await ctx.reply('⌛ Searching for movies...');
            const searchResults = await searchMovies(movieName);

            if (!searchResults || !searchResults.results || searchResults.results.length === 0) {
                await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id);
                await logger.command(
                    ctx.from.id,
                    `${ctx.from.first_name} (${ctx.from.username || 'Untitled'})` || 'Unknown',
                    'Post command used',
                    'FAILED',
                    `No movies found for: ${movieName}`
                );
                return ctx.reply(`❌ No movies found for: "${movieName}"`);
            }

            bot.context.searchCache = bot.context.searchCache || {};
            const queryId = `q${ctx.from.id}_${Date.now()}`;
            
            bot.context.searchCache[queryId] = {
                query: movieName,
                downloadLink,
                currentPage: 1,
                totalPages: searchResults.total_pages,
                results: searchResults
            };

            const movieButtons = searchResults.results.map(movie => {
                const year = movie.release_date ? new Date(movie.release_date).getFullYear() : 'N/A';
                return [Markup.button.callback(
                    `${movie.title} (${year})`,
                    `movie_${movie.id}_${queryId}`
                )];
            });

            if (searchResults.total_pages > 1) {
                movieButtons.push(
                    createPaginationKeyboard(queryId, 1, searchResults.total_pages)
                );
            }

            await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id);

            await ctx.reply(
                `🎬 Found ${searchResults.total_results} results for "${movieName}"\n\nPlease select a movie:`,
                Markup.inlineKeyboard(movieButtons)
            );

            await logger.command(
                ctx.from.id,
                `${ctx.from.first_name} (${ctx.from.username || 'Untitled'})` || 'Unknown',
                'Post command used',
                'SUCCESS',
                `Searched for movie: ${movieName}, found ${searchResults.total_results} results`
            );
            
        } catch (error) {
            console.error('Error in post command:', error);
            await logger.error(
                ctx.from.id,
                `${ctx.from.first_name} (${ctx.from.username || 'Untitled'})` || 'Unknown',
                'Post command used',
                'FAILED',
                error.message
            );
            await ctx.reply('Error searching for movies. Please try again.');
        }
    });

    bot.action(/^page_(.+)_(\d+)$/, async (ctx) => {
        try {
            const queryId = ctx.match[1];
            const page = parseInt(ctx.match[2]);
            
            if (!bot.context.searchCache || !bot.context.searchCache[queryId]) {
                return ctx.answerCbQuery('Session expired. Please search again.');
            }
            
            const cachedSearch = bot.context.searchCache[queryId];
            const searchResults = await searchMovies(cachedSearch.query, page);
            
            if (!searchResults || !searchResults.results || searchResults.results.length === 0) {
                await ctx.answerCbQuery('No results found on this page');
                return;
            }

            cachedSearch.currentPage = page;
            cachedSearch.results = searchResults;

            const movieButtons = searchResults.results.map(movie => {
                const year = movie.release_date ? new Date(movie.release_date).getFullYear() : 'N/A';
                return [Markup.button.callback(
                    `${movie.title} (${year})`,
                    `movie_${movie.id}_${queryId}`
                )];
            });

            movieButtons.push(
                createPaginationKeyboard(queryId, page, searchResults.total_pages)
            );

            await ctx.editMessageText(
                `🎬 Found ${searchResults.total_results} results for "${cachedSearch.query}" (Page ${page}/${searchResults.total_pages})\n\nPlease select a movie:`,
                Markup.inlineKeyboard(movieButtons)
            );
            
            await ctx.answerCbQuery();
        } catch (error) {
            console.error('Error handling pagination:', error);
            await ctx.answerCbQuery('Error loading page');
        }
    });

    bot.action('noop', async (ctx) => {
        await ctx.answerCbQuery();
    });

    bot.action(/^movie_(\d+)_(.+)$/, async (ctx) => {
        try {
            const movieId = ctx.match[1];
            const queryId = ctx.match[2];

            if (!bot.context.searchCache || !bot.context.searchCache[queryId]) {
                return ctx.answerCbQuery('Session expired. Please search again.');
            }
            
            const cachedSearch = bot.context.searchCache[queryId];
            const downloadLink = cachedSearch.downloadLink;

            await ctx.answerCbQuery('Loading movie details...');
            await ctx.editMessageText('⌛ Fetching movie details...');

            const movieData = await getMovieDetails(movieId);
            
            if (!movieData) {
                return ctx.editMessageText('❌ Error fetching movie details. Please try again.');
            }

            const post = createMoviePost(movieData, downloadLink);
            const posterUrl = getMoviePosterUrl(movieData);
            const postSetting = await Post.getLatestForAdmin(ctx.from.id);
            
            const channelInfo = postSetting.channelUsername ? 
                `@${postSetting.channelUsername}` : 
                postSetting.channelId;
            
            const postId = `p${ctx.from.id}_${Date.now()}`;
            
            const confirmationButtons = Markup.inlineKeyboard([
                [
                    Markup.button.callback('✅ Post to Channel', `confirm_${postId}`),
                    Markup.button.callback('❌ Cancel', `cancel_${postId}`)
                ]
            ]);

            bot.context.postData = bot.context.postData || {};
            bot.context.postData[postId] = {
                movieData,
                downloadLink,
                posterUrl,
                post,
                channelId: postSetting.channelId,
                channelInfo
            };
            
            if (posterUrl) {
                await ctx.telegram.sendPhoto(ctx.chat.id, posterUrl, {
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
            
            if (bot.context.searchCache && bot.context.searchCache[queryId]) {
                delete bot.context.searchCache[queryId];
            }
            
            await logger.command(
                ctx.from.id,
                `${ctx.from.first_name} (${ctx.from.username || 'Untitled'})` || 'Unknown',
                'Movie selected',
                'SUCCESS',
                `Created post preview for movie: ${movieData.title}`
            );
            
        } catch (error) {
            console.error('Error selecting movie:', error);
            await ctx.answerCbQuery('Error loading movie');
            await ctx.editMessageText('Error creating movie post. Please try again.');
            
            await logger.error(
                ctx.from.id,
                `${ctx.from.first_name} (${ctx.from.username || 'Untitled'})` || 'Unknown',
                'Movie selection',
                'FAILED',
                error.message
            );
        }
    });
    
    bot.action(/^confirm_(.+)$/, async (ctx) => {
        try {
            setTimeout(async () => {
                await ctx.deleteMessage()
            }, 10000)

            const postId = ctx.match[1];
            
            if (!bot.context.postData || !bot.context.postData[postId]) {
                await ctx.answerCbQuery('❌ Post data not found');
                return ctx.editMessageText('Unable to find post data. Please create a new post.');
            }
            
            const postData = bot.context.postData[postId];
            const postSetting = await Post.getLatestForAdmin(ctx.from.id);
            
            let sentMessage;
            if (postData.posterUrl) {
                sentMessage = await ctx.telegram.sendPhoto(postData.channelId, postData.posterUrl, {
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

            const postConfimationMsg = '✅ Post sent to channel!'
            await ctx.answerCbQuery(postConfimationMsg);
            const detailedMsg = `✅ Post for "${postData.movieData.title}" has been sent to ${postData.channelInfo} successfully!`
            await ctx.editMessageText(detailedMsg);
            
            await logger.command(
                ctx.from.id,
                `${ctx.from.first_name} (${ctx.from.username || 'Untitled'})` || 'Unknown',
                'Post to channel',
                'SUCCESS',
                `Posted ${postData.movieData.title} to channel ${postData.channelInfo}`
            );
            
            delete bot.context.postData[postId];
            
        } catch (error) {
            console.error('Error sending post to channel:', error);
            await ctx.answerCbQuery('❌ Error sending post');
            await ctx.editMessageText('Error sending post to channel. Please check bot permissions and try again.');
            
            await logger.error(
                ctx.from.id,
                `${ctx.from.first_name} (${ctx.from.username || 'Untitled'})` || 'Unknown',
                'Post to channel',
                'FAILED',
                error.message
            );
        }
    });
    
    bot.action(/^cancel_(.+)$/, async (ctx) => {
        try {
            setTimeout(async () => {
                await ctx.deleteMessage()
            }, 10000)

            const postId = ctx.match[1];
            
            if (bot.context.postData && bot.context.postData[postId]) {
                delete bot.context.postData[postId];
            }
            
            await ctx.answerCbQuery('Post cancelled');
            await ctx.editMessageText('❌ Post cancelled.');
            
        } catch (error) {
            console.error('Error cancelling post:', error);
            await ctx.answerCbQuery('Error cancelling post');
            await ctx.editMessageText('Error occurred while cancelling post.');
        }
    });
};

module.exports = setupPostCommand;
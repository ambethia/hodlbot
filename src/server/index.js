import Bot from '../bot'

const server = (app) => {
  app.get('/deposits', (req, res) => {
    res.json([])
  })
}

const bot = new Bot()
bot.run()
setInterval(() => {
  bot.run()
}, 60 * 60 * 1000)

export default server

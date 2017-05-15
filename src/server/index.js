import Bot from '../bot'

const bot = new Bot()

const server = (app) => {
  app.get('/orders', (req, res) => {
    res.json(bot.orderBook)
  })
}

export default server

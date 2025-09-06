import {getDocument, OPS} from 'pdfjs-dist'
import {PNG} from 'pngjs'
import { Telegraf } from 'telegraf'

function resizePng(png, targetWidth, targetHeight) {
  const resized = new PNG({width: targetWidth, height: targetHeight})
  for (let y = 0; y < targetHeight; y++) {
    for (let x = 0; x < targetWidth; x++) {
      // Nearest neighbor scaling
      const srcX = Math.floor(x * png.width / targetWidth)
      const srcY = Math.floor(y * png.height / targetHeight)
      const srcIdx = (srcY * png.width + srcX) << 2
      const dstIdx = (y * targetWidth + x) << 2
      resized.data[dstIdx] = png.data[srcIdx]
      resized.data[dstIdx + 1] = png.data[srcIdx + 1]
      resized.data[dstIdx + 2] = png.data[srcIdx + 2]
      resized.data[dstIdx + 3] = png.data[srcIdx + 3]
    }
  }
  return resized
}

function combinePngsSideBySide(png1, png2, gap = 50, margin = 30) {
  const combinedWidth = png1.width + png2.width + gap + margin * 2
  const combinedHeight = Math.max(png1.height, png2.height) + margin * 2
  const combined = new PNG({width: combinedWidth, height: combinedHeight})

  // Fill background with white (optional)
  for (let i = 0; i < combined.data.length; i += 4) {
    combined.data[i] = 255
    combined.data[i + 1] = 255
    combined.data[i + 2] = 255
    combined.data[i + 3] = 255
  }

  // Copy png1 data with margin offset
  for (let y = 0; y < png1.height; y++) {
    for (let x = 0; x < png1.width; x++) {
      const srcIdx = (y * png1.width + x) << 2
      const dstIdx = ((y + margin) * combinedWidth + (x + margin)) << 2
      combined.data[dstIdx] = png1.data[srcIdx]
      combined.data[dstIdx + 1] = png1.data[srcIdx + 1]
      combined.data[dstIdx + 2] = png1.data[srcIdx + 2]
      combined.data[dstIdx + 3] = png1.data[srcIdx + 3]
    }
  }

  // Copy png2 data with gap and margin offset
  for (let y = 0; y < png2.height; y++) {
    for (let x = 0; x < png2.width; x++) {
      const srcIdx = (y * png2.width + x) << 2
      const dstIdx = ((y + margin) * combinedWidth + (x + png1.width + gap + margin)) << 2
      combined.data[dstIdx] = png2.data[srcIdx]
      combined.data[dstIdx + 1] = png2.data[srcIdx + 1]
      combined.data[dstIdx + 2] = png2.data[srcIdx + 2]
      combined.data[dstIdx + 3] = png2.data[srcIdx + 3]
    }
  }

  return combined
}

function convertPngToGrayscale(png) {
  const gray = new PNG({width: png.width, height: png.height})
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const idx = (y * png.width + x) << 2
      const r = png.data[idx]
      const g = png.data[idx + 1]
      const b = png.data[idx + 2]
      // Luminosity method for grayscale
      const grayVal = Math.round(0.21 * r + 0.72 * g + 0.07 * b)
      gray.data[idx] = grayVal
      gray.data[idx + 1] = grayVal
      gray.data[idx + 2] = grayVal
      gray.data[idx + 3] = png.data[idx + 3] // preserve alpha
    }
  }
  return gray
}

export async function extractImagesFromPdf(pdfPath) {
  const loadingTask = getDocument(pdfPath)
  const pdf = await loadingTask.promise

  const numPages = pdf.numPages
  const images = []

  for (let i = 1; i <= numPages; i++) {
    const page = await pdf.getPage(i)
    const ops = await page.getOperatorList()

    for (let j = 0; j < ops.fnArray.length; j++) {
      if (ops.fnArray[j] === OPS.paintImageXObject) {
        const args = ops.argsArray[j]
        const imgName = args[0]
        const imgObj = page.objs.get(imgName)
        const {width, height, data: imgData} = imgObj
        if (!(imgData instanceof Uint8ClampedArray) || typeof width !== 'number' || typeof height !== 'number') continue

        const png = new PNG({width, height})
        png.data = Buffer.from(rgbToRgba(imgData))

        // Resize to 1279x2048
        const resizedPng = resizePng(png, 1279, 2048)

        images.push(resizedPng)
      }
    }
  }
  return images
}

const bot = new Telegraf('8095395121:AAGaMatgwTE_asHZWcMb1YLKY0n93ZWWsEY')

bot.start((ctx) => ctx.reply('Welcome! Send me a PDF file, and I will extract images for you.'))

bot.on('document', async (ctx) => {
  try {
    await ctx.telegram.sendChatAction(ctx.chat.id, 'typing')
    const fileId = ctx.message.document.file_id
    const fileLink = await ctx.telegram.getFileLink(fileId)
    const response = await fetch(fileLink.href)
    const arrayBuffer = await response.arrayBuffer()
    const images = await extractImagesFromPdf(arrayBuffer)
    if (images.length === 0) {
      await ctx.reply('No images found in the PDF.')
    } else {
      const lastTwoImages = images.slice(-2)
      const combinedPng = combinePngsSideBySide(lastTwoImages[0], lastTwoImages[1], 50, 30)
      const combinedBuffer = PNG.sync.write(combinedPng)
      await ctx.replyWithPhoto({ source: combinedBuffer })

      // Convert to grayscale and send
      const grayPng = convertPngToGrayscale(combinedPng)
      const grayBuffer = PNG.sync.write(grayPng)
      await ctx.replyWithPhoto({ source: grayBuffer })
    }
  } catch (error) {
    await ctx.reply('Failed to extract images from the PDF.')
  }
})

bot.launch()

function rgbToRgba(imgData) {
  const rgbaData = new Uint8ClampedArray((imgData.length / 3) * 4)
  for (let i = 0; i < imgData.length; i += 3) {
    rgbaData[(i * 4) / 3] = imgData[i]
    rgbaData[(i * 4) / 3 + 1] = imgData[i + 1]
    rgbaData[(i * 4) / 3 + 2] = imgData[i + 2]
    rgbaData[(i * 4) / 3 + 3] = 255
  }
  return rgbaData
}

 
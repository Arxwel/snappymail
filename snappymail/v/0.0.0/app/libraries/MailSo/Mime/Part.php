<?php

/*
 * This file is part of MailSo.
 *
 * (c) 2014 Usenko Timur
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

namespace MailSo\Mime;

/**
 * @category MailSo
 * @package Mime
 */
class Part
{
	const POS_HEADERS = 1;
	const POS_BODY = 2;
	const POS_SUBPARTS = 3;
	const POS_CLOSE_BOUNDARY = 4;

	const DEFAUL_BUFFER = 8192;

	/**
	 * @var string
	 */
	public static $DefaultCharset = \MailSo\Base\Enumerations\Charset::ISO_8859_1;

	/**
	 * @var string
	 */
	public static $ForceCharset = '';

	/**
	 * @var HeaderCollection
	 */
	public $Headers;

	/**
	 * @var resource
	 */
	public $Body;

	/**
	 * @var PartCollection
	 */
	public $SubParts;

	/**
	 * @var array
	 */
	public $LineParts;

	/**
	 * @var string
	 */
	private $sBoundary;

	/**
	 * @var string
	 */
	private $sParentCharset;

	/**
	 * @var int
	 */
	private $iParseBuffer;

	function __construct()
	{
		$this->iParseBuffer = self::DEFAUL_BUFFER;
		$this->Reset();
	}

	public function Reset() : self
	{
		\MailSo\Base\ResourceRegistry::CloseMemoryResource($this->Body);
		$this->Body = null;

		$this->Headers = new HeaderCollection;
		$this->SubParts = new PartCollection;
		$this->LineParts = array();
		$this->sBoundary = '';
		$this->sParentCharset = \MailSo\Base\Enumerations\Charset::ISO_8859_1;

		return $this;
	}

	public function Boundary() : string
	{
		return $this->sBoundary;
	}

	public function ParentCharset() : string
	{
		return (\strlen($this->sCharset)) ? $this->sParentCharset : self::$DefaultCharset;
	}

	public function SetParentCharset(string $sParentCharset) : self
	{
		$this->sParentCharset = $sParentCharset;

		return $this;
	}

	public function SetBoundary(string $sBoundary) : self
	{
		$this->sBoundary = $sBoundary;

		return $this;
	}

	public function SetParseBuffer(int $iParseBuffer) : self
	{
		$this->iParseBuffer = $iParseBuffer;

		return $this;
	}

	public function HeaderCharset() : string
	{
		return ($this->Headers) ? \trim(\strtolower($this->Headers->ParameterValue(
			Enumerations\Header::CONTENT_TYPE,
			Enumerations\Parameter::CHARSET))) : '';
	}

	public function HeaderBoundary() : string
	{
		return ($this->Headers) ? \trim($this->Headers->ParameterValue(
			Enumerations\Header::CONTENT_TYPE,
			Enumerations\Parameter::BOUNDARY)) : '';
	}

	public function ContentType() : string
	{
		return ($this->Headers) ?
			\trim(\strtolower($this->Headers->ValueByName(
				Enumerations\Header::CONTENT_TYPE))) : '';
	}

	public function ContentTransferEncoding() : string
	{
		return ($this->Headers) ?
			\trim(\strtolower($this->Headers->ValueByName(
				Enumerations\Header::CONTENT_TRANSFER_ENCODING))) : '';
	}

	public function ContentID() : string
	{
		return ($this->Headers) ? \trim($this->Headers->ValueByName(
			Enumerations\Header::CONTENT_ID)) : '';
	}

	public function ContentLocation() : string
	{
		return ($this->Headers) ? \trim($this->Headers->ValueByName(
			Enumerations\Header::CONTENT_LOCATION)) : '';
	}

	public function IsFlowedFormat() : bool
	{
		$bResult = false;
		if ($this->Headers)
		{
			$bResult = 'flowed' === \trim(\strtolower($this->Headers->ParameterValue(
				Enumerations\Header::CONTENT_TYPE,
				Enumerations\Parameter::FORMAT)));

			if ($bResult && \in_array(\strtolower($this->MailEncodingName()), array('base64', 'quoted-printable')))
			{
				$bResult = false;
			}
		}

		return $bResult;
	}

	public function FileName() : string
	{
		$sResult = '';
		if ($this->Headers)
		{
			$sResult = \trim($this->Headers->ParameterValue(
				Enumerations\Header::CONTENT_DISPOSITION,
				Enumerations\Parameter::FILENAME));

			if (!\strlen($sResult))
			{
				$sResult = \trim($this->Headers->ParameterValue(
					Enumerations\Header::CONTENT_TYPE,
					Enumerations\Parameter::NAME));
			}
		}

		return $sResult;
	}

	public function ParseFromFile(string $sFileName) : self
	{
		$rStreamHandle = \file_exists($sFileName) ? \fopen($sFileName, 'rb') : false;
		if (\is_resource($rStreamHandle))
		{
			$this->ParseFromStream($rStreamHandle);

			if (\is_resource($rStreamHandle))
			{
				\fclose($rStreamHandle);
			}
		}

		return $this;
	}

	public function ParseFromString(string $sRawMessage) : self
	{
		$rStreamHandle = \strlen($sRawMessage) ?
			\MailSo\Base\ResourceRegistry::CreateMemoryResource() : false;

		if (\is_resource($rStreamHandle))
		{
			\fwrite($rStreamHandle, $sRawMessage);
			unset($sRawMessage);
			\fseek($rStreamHandle, 0);

			$this->ParseFromStream($rStreamHandle);

			\MailSo\Base\ResourceRegistry::CloseMemoryResource($rStreamHandle);
		}

		return $this;
	}

	/**
	 * @param resource $rStreamHandle
	 */
	public function ParseFromStream($rStreamHandle) : self
	{
		$this->Reset();

		$oParserClass = new Parser\ParserMemory;

		$oMimePart = null;
		$bIsOef = false;
		$iOffset = 0;
		$sBuffer = '';
		$sPrevBuffer = '';
		$aBoundaryStack = array();


		$oParserClass->StartParse($this);

		$this->LineParts[] =& $this;
		$this->ParseFromStreamRecursion($rStreamHandle, $oParserClass, $iOffset,
			$sPrevBuffer, $sBuffer, $aBoundaryStack, $bIsOef);

		$sFirstNotNullCharset = null;
		foreach ($this->LineParts as /* @var $oMimePart Part */ $oMimePart)
		{
			$sCharset = $oMimePart->HeaderCharset();
			if (\strlen($sCharset))
			{
				$sFirstNotNullCharset = $sCharset;
				break;
			}
		}

		$sForceCharset = self::$ForceCharset;
		if (\strlen($sForceCharset))
		{
			foreach ($this->LineParts as /* @var $oMimePart Part */ $oMimePart)
			{
				$oMimePart->SetParentCharset($sForceCharset);
				$oMimePart->Headers->SetParentCharset($sForceCharset);
			}
		}
		else
		{
			$sFirstNotNullCharset = (null !== $sFirstNotNullCharset)
				? $sFirstNotNullCharset : self::$DefaultCharset;

			foreach ($this->LineParts as /* @var $oMimePart Part */ $oMimePart)
			{
				$sHeaderCharset = $oMimePart->HeaderCharset();
				$oMimePart->SetParentCharset((\strlen($sHeaderCharset)) ? $sHeaderCharset : $sFirstNotNullCharset);
				$oMimePart->Headers->SetParentCharset($sHeaderCharset);
			}
		}

		$oParserClass->EndParse($this);

		return $this;
	}

	/**
	 * @param resource $rStreamHandle
	 */
	public function ParseFromStreamRecursion($rStreamHandle, $oCallbackClass, int &$iOffset,
		string &$sPrevBuffer, string &$sBuffer, array &$aBoundaryStack, bool &$bIsOef, bool $bNotFirstRead = false) : self
	{
		$oCallbackClass->StartParseMimePart($this);

		$iPos = 0;
		$iParsePosition = self::POS_HEADERS;
		$sCurrentBoundary = '';
		$bIsBoundaryCheck = false;
		$aHeadersLines = array();
		while (true)
		{
			if (!$bNotFirstRead)
			{
				$sPrevBuffer = $sBuffer;
				$sBuffer = '';
			}

			if (!$bIsOef && !\feof($rStreamHandle))
			{
				if (!$bNotFirstRead)
				{
					$sBuffer = \fread($rStreamHandle, $this->iParseBuffer);
					if (false === $sBuffer)
					{
						break;
					}

					$oCallbackClass->ReadBuffer($sBuffer);
				}
				else
				{
					$bNotFirstRead = false;
				}
			}
			else if ($bIsOef && !\strlen($sBuffer))
			{
				break;
			}
			else
			{
				$bIsOef = true;
			}

			while (true)
			{
				$sCurrentLine = $sPrevBuffer.$sBuffer;
				if (self::POS_HEADERS === $iParsePosition)
				{
					$iEndLen = 4;
					$iPos = \strpos($sCurrentLine, "\r\n\r\n", $iOffset);
					if (false === $iPos)
					{
						$iEndLen = 2;
						$iPos = \strpos($sCurrentLine, "\n\n", $iOffset);
					}

					if (false !== $iPos)
					{
						$aHeadersLines[] = \substr($sCurrentLine, $iOffset, $iPos + $iEndLen - $iOffset);

						$this->Headers->Parse(\implode($aHeadersLines))->SetParentCharset($this->HeaderCharset());
						$aHeadersLines = array();

						$oCallbackClass->InitMimePartHeader();

						$sBoundary = $this->HeaderBoundary();
						if (\strlen($sBoundary))
						{
							$sBoundary = '--'.$sBoundary;
							$sCurrentBoundary = $sBoundary;
							\array_unshift($aBoundaryStack, $sBoundary);
						}

						$iOffset = $iPos + $iEndLen;
						$iParsePosition = self::POS_BODY;
						continue;
					}
					else
					{
						$iBufferLen = \strlen($sPrevBuffer);
						if ($iBufferLen > $iOffset)
						{
							$aHeadersLines[] = \substr($sPrevBuffer, $iOffset);
							$iOffset = 0;
						}
						else
						{
							$iOffset -= $iBufferLen;
						}
						break;
					}
				}
				else if (self::POS_BODY === $iParsePosition)
				{
					$iPos = false;
					$sBoundaryLen = 0;
					$bIsBoundaryEnd = false;
					$bCurrentPartBody = false;
					$bIsBoundaryCheck = \count($aBoundaryStack);

					foreach ($aBoundaryStack as $sKey => $sBoundary)
					{
						if (false !== ($iPos = \strpos($sCurrentLine, $sBoundary, $iOffset)))
						{
							if ($sCurrentBoundary === $sBoundary)
							{
								$bCurrentPartBody = true;
							}

							$sBoundaryLen = \strlen($sBoundary);
							if ('--' === \substr($sCurrentLine, $iPos + $sBoundaryLen, 2))
							{
								$sBoundaryLen += 2;
								$bIsBoundaryEnd = true;
								unset($aBoundaryStack[$sKey]);
								$sCurrentBoundary = (isset($aBoundaryStack[$sKey + 1]))
									? $aBoundaryStack[$sKey + 1] : '';
							}

							break;
						}
					}

					if (false !== $iPos)
					{
						$oCallbackClass->WriteBody(\substr($sCurrentLine, $iOffset, $iPos - $iOffset));
						$iOffset = $iPos;

						if ($bCurrentPartBody)
						{
							$iParsePosition = self::POS_SUBPARTS;
							continue;
						}

						$oCallbackClass->EndParseMimePart($this);
						return true;
					}
					else
					{
						$iBufferLen = \strlen($sPrevBuffer);
						if ($iBufferLen > $iOffset)
						{
							$oCallbackClass->WriteBody(\substr($sPrevBuffer, $iOffset));
							$iOffset = 0;
						}
						else
						{
							$iOffset -= $iBufferLen;
						}
						break;
					}
				}
				else if (self::POS_SUBPARTS === $iParsePosition)
				{
					$iPos = false;
					$iBoundaryLen = 0;
					$bIsBoundaryEnd = false;
					$bCurrentPartBody = false;
					$bIsBoundaryCheck = \count($aBoundaryStack);

					foreach ($aBoundaryStack as $sKey => $sBoundary)
					{
						if (false !== ($iPos = \strpos($sCurrentLine, $sBoundary, $iOffset)))
						{
							if ($sCurrentBoundary === $sBoundary)
							{
								$bCurrentPartBody = true;
							}

							$iBoundaryLen = \strlen($sBoundary);
							if ('--' === \substr($sCurrentLine, $iPos + $iBoundaryLen, 2))
							{
								$iBoundaryLen += 2;
								$bIsBoundaryEnd = true;
								unset($aBoundaryStack[$sKey]);
								$sCurrentBoundary = (isset($aBoundaryStack[$sKey + 1]))
									? $aBoundaryStack[$sKey + 1] : '';
							}
							break;
						}
					}

					if (false !== $iPos && $bCurrentPartBody)
					{
						$iOffset = $iPos + $iBoundaryLen;

						$oSubPart = new self;

						$oSubPart
							->SetParseBuffer($this->iParseBuffer)
							->ParseFromStreamRecursion($rStreamHandle, $oCallbackClass,
								$iOffset, $sPrevBuffer, $sBuffer, $aBoundaryStack, $bIsOef, true);

						$this->SubParts->append($oSubPart);
						$this->LineParts[] =& $oSubPart;
						//$iParsePosition = self::POS_HEADERS;
						unset($oSubPart);
					}
					else
					{
						$oCallbackClass->EndParseMimePart($this);
						return true;
					}
				}
			}
		}

		if (\strlen($sPrevBuffer))
		{
			if (self::POS_HEADERS === $iParsePosition)
			{
				$aHeadersLines[] = ($iOffset < \strlen($sPrevBuffer))
					? \substr($sPrevBuffer, $iOffset)
					: $sPrevBuffer;

				$this->Headers->Parse(\implode($aHeadersLines))->SetParentCharset($this->HeaderCharset());
				$aHeadersLines = array();

				$oCallbackClass->InitMimePartHeader();
			}
			else if (self::POS_BODY === $iParsePosition)
			{
				if (!$bIsBoundaryCheck)
				{
					$oCallbackClass->WriteBody(($iOffset < \strlen($sPrevBuffer))
						? \substr($sPrevBuffer, $iOffset) : $sPrevBuffer);
				}
			}
		}
		else
		{
			if (self::POS_HEADERS === $iParsePosition && \count($aHeadersLines))
			{
				$this->Headers->Parse(\implode($aHeadersLines))->SetParentCharset($this->HeaderCharset());
				$aHeadersLines = array();

				$oCallbackClass->InitMimePartHeader();
			}
		}

		$oCallbackClass->EndParseMimePart($this);

		return $this;
	}

	/**
	 * @return resource
	 */
	public function Rewind()
	{
		if ($this->Body && \is_resource($this->Body))
		{
			$aMeta = \stream_get_meta_data($this->Body);
			if (isset($aMeta['seekable']) && $aMeta['seekable'])
			{
				\rewind($this->Body);
			}
		}
	}

	/**
	 * @return resource
	 */
	public function ToStream()
	{
		$this->Rewind();

		$aSubStreams = array(

			$this->Headers->ToEncodedString().
				Enumerations\Constants::CRLF.
				Enumerations\Constants::CRLF,

			null === $this->Body ? '' : $this->Body,

			Enumerations\Constants::CRLF
		);

		if (0 < $this->SubParts->Count())
		{
			$sBoundary = $this->HeaderBoundary();
			if (\strlen($sBoundary))
			{
				$aSubStreams[] = '--'.$sBoundary.Enumerations\Constants::CRLF;

				$rSubPartsStream = $this->SubParts->ToStream($sBoundary);
				if (\is_resource($rSubPartsStream))
				{
					$aSubStreams[] = $rSubPartsStream;
				}

				$aSubStreams[] = Enumerations\Constants::CRLF.
					'--'.$sBoundary.'--'.Enumerations\Constants::CRLF;
			}
		}

		return \MailSo\Base\StreamWrappers\SubStreams::CreateStream($aSubStreams);
	}
}

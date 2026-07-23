/** Flip-clock display used by immersive wall clock scene and scene picker. */
export function ClockFace({ className, value }: { className: string; value: string }) {
  return (
    <span className={`workbench-clock__face ${className}`} aria-hidden="true">
      <span className="workbench-clock__face-value">{value}</span>
    </span>
  )
}

function ClockDigit({ value, previousValue, shouldFlip }: {
  value: string
  previousValue: string
  shouldFlip: boolean
}) {
  return (
    <span className={`workbench-clock__digit${shouldFlip ? ' is-flipping' : ''}`}>
      <ClockFace className="workbench-clock__face--current-top" value={value} />
      <ClockFace className="workbench-clock__face--current-bottom" value={value} />
      {shouldFlip ? (
        <>
          <ClockFace className="workbench-clock__face--previous-top" value={previousValue} />
          <ClockFace className="workbench-clock__face--previous-bottom" value={previousValue} />
          <ClockFace className="workbench-clock__face--next-bottom" value={value} />
        </>
      ) : null}
    </span>
  )
}

export function ClockDisplay({ time, previousTime }: { time: Date; previousTime: Date | null }) {
  const hours = String(time.getHours()).padStart(2, '0')
  const minutes = String(time.getMinutes()).padStart(2, '0')
  const previousHours = String(previousTime?.getHours() ?? time.getHours()).padStart(2, '0')
  const previousMinutes = String(previousTime?.getMinutes() ?? time.getMinutes()).padStart(2, '0')
  const digits = [
    { value: hours[0], previousValue: previousHours[0] },
    { value: hours[1], previousValue: previousHours[1] },
    { value: minutes[0], previousValue: previousMinutes[0] },
    { value: minutes[1], previousValue: previousMinutes[1] }
  ]
  // A real flip clock turns every card at the minute boundary—even the digits
  // that retain the same value—so use the refreshed timestamp as the card key.
  const turnKey = time.getTime()
  const shouldFlip = previousTime !== null

  return (
    <time className="workbench-clock__display" dateTime={time.toISOString()} aria-label={`当前时间 ${hours}:${minutes}`}>
      <span className="workbench-clock__pair">
        {digits.slice(0, 2).map((digit, index) => (
          <ClockDigit
            key={`hour-${index}-${turnKey}`}
            value={digit.value}
            previousValue={digit.previousValue}
            shouldFlip={shouldFlip}
          />
        ))}
      </span>
      <span className="workbench-clock__pair">
        {digits.slice(2).map((digit, index) => (
          <ClockDigit
            key={`minute-${index}-${turnKey}`}
            value={digit.value}
            previousValue={digit.previousValue}
            shouldFlip={shouldFlip}
          />
        ))}
      </span>
    </time>
  )
}

